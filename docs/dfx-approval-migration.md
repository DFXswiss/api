# Ablösung der acht DfxApproval-GSheets

## Umfang

Der neue API-Workflow ersetzt ausschliesslich die acht minütlichen Personal-Onboarding-Projekte:

1. DfxApproval-Freigabe
2. DfxApproval-Risikoflags
3. `GwGFileCover`
4. `IdentificationForm`
5. `CustomerProfile`
6. `RiskProfile`
7. `FormA`
8. `DfxNameCheck`

`IdentReport` und `PersonalNameCheck` werden weiterhin von ihren bestehenden KYC-Prozessen erzeugt.
Sie gehören zum Freigabe-Gate, sind aber keine der acht abzulösenden GSheets. Organisationen sind
nicht Teil dieser Personal-GSheet-Migration.

## Ablauf in der API

`DfxApprovalWorkflowService` sucht jede Minute höchstens 50 der ältesten Personal-Fälle mit
`DfxApproval = ManualReview` und `kycLevel >= 40`. Der Prozess ist standardmässig ausgeschaltet und
wird erst mit `KYC_DFX_APPROVAL_WORKFLOW_ENABLED=true` aktiviert.

Pro Fall gilt:

1. Ein PostgreSQL-Advisory-Lock verhindert parallele Verarbeitung durch mehrere API-Instanzen.
2. Nur nach einem höchstens 90 Tage alten, abgeschlossenen NameCheck werden noch leere
   Personal-Risikofelder mit den bisherigen GSheet-Werten initialisiert: `pep=false`,
   `highRisk=false`, `complexOrgStructure=false` und `depositLimit=100000`. `amlAccountType` wird wie
   im Freigabe-Sheet erst für den DfxApproval-Fall auf `natural person` gesetzt. Vorhandene Werte
   werden nie überschrieben und jede Änderung wird im `kyc_log` protokolliert.
3. Die sechs fehlenden PDF-Nachweise werden mit `pdf-lib` direkt auf Kopien der produktiven
   Google-Sheet-PDF-Vorlagen geschrieben und über einen eindeutigen
   `generationKey` idempotent im WORM-Storage gespeichert. Ein `kyc_file` wird erst nach erfolgreichem
   Upload als gültig markiert.
4. Das serverseitige Gate prüft alle fachlichen Voraussetzungen und alle acht Dokumenttypen.
5. Nur ein vollständig freier Fall wird in einer DB-Transaktion auf `DfxApproval = Completed`,
   `kycLevel = 50` und `kycStatus = Completed` gesetzt. Step- und KYC-Logs werden in derselben
   Transaktion geschrieben; die Benachrichtigung folgt erst nach dem Commit.

Die sechs Dokumente behalten ihre voneinander unabhängigen GSheet-Auswahlregeln:

- `GwGFileCover`, `IdentificationForm` und `DfxNameCheck`: DfxApproval in `InternalReview` oder
  `ManualReview`; die spezifischen Prüfungen auf Personal, Name, Nationalität und Merge-Status gelten
  je Dokument.
- `CustomerProfile`: abgeschlossene FinancialData für Personal-Konten mit `30 <= kycLevel < 50`.
- `RiskProfile` und `FormA`: DFX-Personal-Konten mit `30 <= kycLevel < 50`; beim RiskProfile zusätzlich
  `highRisk=false` und ein FATF-freigegebenes Wohnsitzland. Die drei produktiven Legacy-Ausnahmen
  `374462`, `374428` und `385169` bleiben bestehen.

Dadurch kann ein Dokument erzeugt werden, auch wenn ein anderes Dokument oder eine spätere
Freigabevoraussetzung noch fehlt. Unvollständige oder ungültige JSON-Daten, offene NameChecks und
Storage-Fehler werden pro Dokument protokolliert; andere Dokumente desselben Falls laufen weiter.
Leere Compliance-Werte werden nicht als `false` interpretiert.

## Automatisches Freigabe-Gate

Die automatische Freigabe verlangt:

- Personal-Konto, DfxApproval `ManualReview`, `kycLevel >= 40`
- `verifiedName`, `kycHash`, Vorname, Geburtstag und E-Mail
- `complexOrgStructure = false`, `highRisk = false`, `pep = false`
- zulässigen User- und KYC-Status
- aktiviertes Land ohne manuelle Länderprüfung; Brasilien bleibt ausgeschlossen
- erlaubten Identifikationsdokumenttyp und vorhandene Dokumentnummer
- vorhandene Nationalität; bei deaktivierter Nationalität einen abgeschlossenen Aufenthaltstitel
- keinen offenen sanktionierten NameCheck
- gültige Dateien für `GwGFileCover`, `IdentReport`, `IdentificationForm`, `CustomerProfile`,
  `RiskProfile`, `FormA`, `DfxNameCheck` und `PersonalNameCheck`

Für diese Migration ist keine Änderung an `DFXswiss/services` und kein zusätzlicher manueller
Endpoint erforderlich. Freigabe, Dokumenterzeugung, Sperren, Idempotenz und Auditierung liegen
vollständig in der API.

## Produktiver Cutover

Die Reihenfolge ist verbindlich, damit GSheets und API niemals parallel schreiben:

1. API inklusive DB-Migration deployen, während `KYC_DFX_APPROVAL_WORKFLOW_ENABLED=false` bleibt.
2. Mit einem Testfall die sechs PDF-Subtypen und die automatische Freigabe im deaktivierten bzw.
   kontrollierten Staging-Betrieb prüfen.
3. Alle acht minütlichen `admin@dfx.swiss`-Trigger deaktivieren, aber für einen schnellen Rollback
   noch nicht löschen.
4. Mindestens drei Minuten prüfen, dass keines der acht Projekte mehr ausgeführt wird.
5. `KYC_DFX_APPROVAL_WORKFLOW_ENABLED=true` setzen und die API kontrolliert neu starten.
6. Über mehrere Minuten Durchsatz, ältesten wartenden Fall, neue `kyc_file`-Subtypen, Step-Logs und
   Fehlerlogs beobachten.
7. Erst nach stabiler Beobachtung die acht alten Trigger endgültig entfernen.

Zusätzlich bleibt `Process.KYC_DFX_APPROVAL` über die bestehende `disabledProcesses`-Einstellung als
schneller Kill-Switch verfügbar.

## Rollback

1. `KYC_DFX_APPROVAL_WORKFLOW_ENABLED=false` setzen oder `KycDfxApproval` über
   `disabledProcesses` ausschalten.
2. Sicherstellen, dass keine API-Ausführung mehr läuft.
3. Die acht alten Trigger wieder aktivieren und deren Ausführungen sowie den Rückstau überwachen.

Die Schema-Migration wird nicht zurückgerollt: `generationKey` ist für bestehende Dateien nullable
und beeinträchtigt den alten Ablauf nicht. Bereits korrekt erzeugte API-Dokumente bleiben gültige
KYC-Nachweise; die alten Sheets müssen vorhandene Subtypen wie bisher überspringen.

## Betriebsüberwachung

Alarmiert werden muss bei:

- wachsender Anzahl `DfxApproval = ManualReview` mit `kycLevel = 40`
- steigendem Alter des ältesten wartenden Falls
- fehlenden oder ungültigen Dokument-Subtypen
- wiederholten `DfxApproval workflow failed`-Logs
- Storage-, PDF-, JSON- oder NameCheck-Fehlern

Ein Rückstau von null ist nur eine Momentaufnahme. Massgeblich sind Durchsatz und Alter der Fälle.
