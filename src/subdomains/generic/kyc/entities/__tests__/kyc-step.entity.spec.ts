import { ConfigService, Configuration } from 'src/config/config';
import { getMetadataArgsStorage } from 'typeorm';
import { Recommendation } from '../../../user/models/recommendation/recommendation.entity';
import { UserData } from '../../../user/models/user-data/user-data.entity';
import { KycLevel, KycType, UserDataStatus } from '../../../user/models/user-data/user-data.enum';
import { KycError } from '../../dto/kyc-error.enum';
import { IdentDocumentType, IdentType } from '../../dto/ident-result-data.dto';
import { IdDocType, ReviewAnswer } from '../../dto/sum-sub.dto';
import { KycStepName } from '../../enums/kyc-step-name.enum';
import { KycStepType, UrlType } from '../../enums/kyc.enum';
import { ReviewStatus } from '../../enums/review-status.enum';
import { SumsubService } from '../../services/integration/sum-sub.service';
import { KycFile } from '../kyc-file.entity';
import { KycStep } from '../kyc-step.entity';
import { StepLog } from '../step-log.entity';

// `Config` is an `export let` assigned by the ConfigService constructor, so constructing one with a
// fixed environment pins the URLs `sessionInfo` builds. 'prd' keeps them free of an env prefix.
const API_URL = 'https://api.dfx.swiss/v2/kyc';

function step(overrides: Partial<KycStep> = {}): KycStep {
  return Object.assign(new KycStep(), { id: 42, ...overrides });
}

function userData(overrides: Partial<UserData> = {}): UserData {
  return Object.assign(new UserData(), overrides);
}

describe('KycStep', () => {
  beforeAll(() => {
    new ConfigService(Object.assign(new Configuration(), { environment: 'prd', kycVersion: '2', defaultVersion: '1' }));
  });

  describe('sessionInfo', () => {
    // Every data step resolves to its own API route. Table-driven so a renamed route fails here
    // rather than silently handing the client a 404.
    const API_ROUTES: [KycStepName, string][] = [
      [KycStepName.CONTACT_DATA, 'data/contact'],
      [KycStepName.PERSONAL_DATA, 'data/personal'],
      [KycStepName.NATIONALITY_DATA, 'data/nationality'],
      [KycStepName.RECOMMENDATION, 'data/recommendation'],
      [KycStepName.OWNER_DIRECTORY, 'data/owner'],
      [KycStepName.LEGAL_ENTITY, 'data/legal'],
      [KycStepName.SOLE_PROPRIETORSHIP_CONFIRMATION, 'data/confirmation'],
      [KycStepName.SIGNATORY_POWER, 'data/signatory'],
      [KycStepName.OPERATIONAL_ACTIVITY, 'data/operational'],
      [KycStepName.AUTHORITY, 'data/authority'],
      [KycStepName.FINANCIAL_DATA, 'data/financial'],
      [KycStepName.ADDITIONAL_DOCUMENTS, 'data/additional'],
      [KycStepName.RECALL_AGREEMENT, 'data/recall'],
      [KycStepName.RESIDENCE_PERMIT, 'data/residence'],
      [KycStepName.STATUTES, 'data/statutes'],
      [KycStepName.PAYMENT_AGREEMENT, 'data/payment'],
      [KycStepName.PHONE_CHANGE, 'data/phone'],
      [KycStepName.ADDRESS_CHANGE, 'data/address'],
      [KycStepName.NAME_CHANGE, 'data/name'],
    ];

    it.each(API_ROUTES)('maps %s to its API route', (name, route) => {
      expect(step({ name }).sessionInfo).toEqual({ url: `${API_URL}/${route}/42`, type: UrlType.API });
    });

    it('carries the account holder name as additional info for BENEFICIAL_OWNER', () => {
      const s = step({
        name: KycStepName.BENEFICIAL_OWNER,
        userData: userData({ firstname: 'Jane', surname: 'Doe' }),
      });

      expect(s.sessionInfo).toEqual({
        url: `${API_URL}/data/beneficial/42`,
        type: UrlType.API,
        additionalInfo: { accountHolder: s.userData.naturalPersonName },
      });
    });

    it('returns an empty NONE url for DFX_APPROVAL, which has no client-facing session', () => {
      expect(step({ name: KycStepName.DFX_APPROVAL }).sessionInfo).toEqual({ url: '', type: UrlType.NONE });
    });

    it('resolves a sumsub IDENT step to a token url', () => {
      jest.spyOn(SumsubService, 'identUrl').mockReturnValue('https://sumsub.test/token');

      const s = step({ name: KycStepName.IDENT, type: KycStepType.SUMSUB_AUTO });

      expect(s.sessionInfo).toEqual({ url: 'https://sumsub.test/token', type: UrlType.TOKEN });
      expect(SumsubService.identUrl).toHaveBeenCalledWith(s);
    });

    it('resolves a manual IDENT step to the manual API route', () => {
      expect(step({ name: KycStepName.IDENT, type: KycStepType.MANUAL }).sessionInfo).toEqual({
        url: `${API_URL}/ident/manual/42`,
        type: UrlType.API,
      });
    });

    it('throws for an IDENT step of an unsupported type', () => {
      expect(() => step({ name: KycStepName.IDENT, type: KycStepType.AUTO }).sessionInfo).toThrow(
        'Invalid ident step type Auto',
      );
    });

    // COMMERCIAL_REGISTER is deprecated and REALUNIT_REGISTRATION is written outside the step
    // machinery; neither has a case, so the switch falls through.
    it.each([KycStepName.COMMERCIAL_REGISTER, KycStepName.REALUNIT_REGISTRATION])(
      'returns undefined for %s, which has no session route',
      (name) => {
        expect(step({ name }).sessionInfo).toBeUndefined();
      },
    );
  });

  describe('create', () => {
    it('creates an IN_PROGRESS step carrying the given sequence number', () => {
      const user = userData({ id: 7 });
      const created = KycStep.create(user, KycStepName.PERSONAL_DATA, 3);

      expect(created).toMatchObject({
        userData: user,
        name: KycStepName.PERSONAL_DATA,
        type: undefined,
        status: ReviewStatus.IN_PROGRESS,
        sequenceNumber: 3,
      });
    });

    it('keeps the step type when one is given', () => {
      const created = KycStep.create(userData(), KycStepName.IDENT, 0, KycStepType.SUMSUB_AUTO);

      expect(created.type).toBe(KycStepType.SUMSUB_AUTO);
    });

    it('rejects an IDENT step without a type, which would have no session url', () => {
      expect(() => KycStep.create(userData(), KycStepName.IDENT, 0)).toThrow('Step type is missing');
    });
  });

  describe('status getters', () => {
    const IN_REVIEW_STATUSES = [
      ReviewStatus.FINISHED,
      ReviewStatus.EXTERNAL_REVIEW,
      ReviewStatus.INTERNAL_REVIEW,
      ReviewStatus.MANUAL_REVIEW,
      ReviewStatus.PARTIALLY_APPROVED,
      ReviewStatus.DATA_REQUESTED,
      ReviewStatus.PAUSED,
    ];

    it.each(IN_REVIEW_STATUSES)('treats %s as in review and therefore as done', (status) => {
      const s = step({ status });

      expect(s.isInReview).toBe(true);
      expect(s.isDone).toBe(true);
      expect(s.isInProgress).toBe(false);
    });

    it.each([ReviewStatus.IN_PROGRESS, ReviewStatus.COMPLETED, ReviewStatus.CANCELED, ReviewStatus.ON_HOLD])(
      'does not treat %s as in review',
      (status) => {
        expect(step({ status }).isInReview).toBe(false);
      },
    );

    it('reports the single-status getters for their own status only', () => {
      expect(step({ status: ReviewStatus.IN_PROGRESS }).isInProgress).toBe(true);
      expect(step({ status: ReviewStatus.COMPLETED }).isInProgress).toBe(false);

      expect(step({ status: ReviewStatus.COMPLETED }).isCompleted).toBe(true);
      expect(step({ status: ReviewStatus.FAILED }).isCompleted).toBe(false);

      expect(step({ status: ReviewStatus.ON_HOLD }).isOnHold).toBe(true);
      expect(step({ status: ReviewStatus.COMPLETED }).isOnHold).toBe(false);

      expect(step({ status: ReviewStatus.FAILED }).isFailed).toBe(true);
      expect(step({ status: ReviewStatus.COMPLETED }).isFailed).toBe(false);

      expect(step({ status: ReviewStatus.CANCELED }).isCanceled).toBe(true);
      expect(step({ status: ReviewStatus.COMPLETED }).isCanceled).toBe(false);

      expect(step({ status: ReviewStatus.OUTDATED }).isOutdated).toBe(true);
      expect(step({ status: ReviewStatus.COMPLETED }).isOutdated).toBe(false);
    });

    it('treats a completed step as done and an in-progress one as not', () => {
      expect(step({ status: ReviewStatus.COMPLETED }).isDone).toBe(true);
      expect(step({ status: ReviewStatus.IN_PROGRESS }).isDone).toBe(false);
    });
  });

  // The pair below decides whether a satisfied PERSONAL_DATA step may be closed. See
  // KycService.completeSatisfiedPersonalDataStep — an error here re-completes rejected data.
  describe('hasSettledVerdict', () => {
    it('is false while the step is still in progress', () => {
      expect(step({ status: ReviewStatus.IN_PROGRESS }).hasSettledVerdict).toBe(false);
    });

    it('is false for a step cancelled before it ever completed (no result)', () => {
      expect(step({ status: ReviewStatus.CANCELED }).hasSettledVerdict).toBe(false);
    });

    it('is true for a cancelled step that kept a result from an earlier completion', () => {
      expect(step({ status: ReviewStatus.CANCELED, result: '{"firstname":"Jane"}' }).hasSettledVerdict).toBe(true);
    });

    it.each([ReviewStatus.COMPLETED, ReviewStatus.FAILED])('is true for %s regardless of result', (status) => {
      expect(step({ status }).hasSettledVerdict).toBe(true);
    });
  });

  describe('isRejected', () => {
    it('is true for a failed step', () => {
      expect(step({ status: ReviewStatus.FAILED }).isRejected).toBe(true);
    });

    it('is true when the restarted marker is present, even after the status moved on', () => {
      expect(step({ status: ReviewStatus.CANCELED, comment: KycError.RESTARTED_STEP }).isRejected).toBe(true);
    });

    it('finds the marker among several semicolon-separated comments', () => {
      const comment = `${KycError.PERSONAL_DATA_NOT_MATCHING};${KycError.RESTARTED_STEP}`;

      expect(step({ status: ReviewStatus.CANCELED, comment }).isRejected).toBe(true);
    });

    it('is false for a completed step without a comment', () => {
      expect(step({ status: ReviewStatus.COMPLETED }).isRejected).toBe(false);
    });

    it('is false for an unrelated comment', () => {
      expect(step({ status: ReviewStatus.COMPLETED, comment: KycError.EXPIRED_STEP }).isRejected).toBe(false);
    });

    it('does not match a comment that merely contains the marker as a substring', () => {
      expect(step({ status: ReviewStatus.COMPLETED, comment: `Not${KycError.RESTARTED_STEP}` }).isRejected).toBe(false);
    });
  });

  describe('state transitions', () => {
    it('reminderSent stamps the date and returns it as an update', () => {
      const s = step();

      const [id, update] = s.reminderSent();

      expect(id).toBe(42);
      expect(update.reminderSentDate).toBeInstanceOf(Date);
      expect(s.reminderSentDate).toBe(update.reminderSentDate);
    });

    it('update applies status, result, appended comment and sequence number', () => {
      const s = step({ comment: 'first' });

      const [, update] = s.update(ReviewStatus.MANUAL_REVIEW, { a: 1 }, 'second', 9);

      expect(update).toEqual({
        status: ReviewStatus.MANUAL_REVIEW,
        result: '{"a":1}',
        comment: 'first;second',
        sequenceNumber: 9,
      });
      expect(s.status).toBe(ReviewStatus.MANUAL_REVIEW);
    });

    it('complete sets COMPLETED and stores the result', () => {
      const s = step();

      const [, update] = s.complete({ firstname: 'Jane' });

      expect(update).toEqual({ status: ReviewStatus.COMPLETED, result: '{"firstname":"Jane"}' });
    });

    it('fail assigns the comment outright rather than appending it', () => {
      const s = step({ comment: 'earlier' });

      const [, update] = s.fail(undefined, KycError.RESTARTED_STEP);

      expect(update.comment).toBe(KycError.RESTARTED_STEP);
      expect(s.comment).toBe(KycError.RESTARTED_STEP);
    });

    it('fail leaves an existing result in place when none is passed', () => {
      const s = step({ result: '{"kept":true}' });

      const [, update] = s.fail();

      expect(update).toEqual({ status: ReviewStatus.FAILED, result: '{"kept":true}', comment: undefined });
    });

    it('pause returns the step to IN_PROGRESS and clears the reminder', () => {
      const s = step({ reminderSentDate: new Date() });

      const [, update] = s.pause('raw');

      expect(update).toEqual({ status: ReviewStatus.IN_PROGRESS, result: 'raw', reminderSentDate: null });
    });

    it('cancel sets CANCELED and does not touch the result', () => {
      const s = step({ result: '{"kept":true}' });

      const [, update] = s.cancel('why');

      expect(update).toEqual({ status: ReviewStatus.CANCELED, comment: 'why' });
      expect(s.result).toBe('{"kept":true}');
    });

    it('inProgress sets IN_PROGRESS and stores the result', () => {
      const [, update] = step().inProgress('raw');

      expect(update).toEqual({ status: ReviewStatus.IN_PROGRESS, result: 'raw' });
    });

    it('ignored sets IGNORED with the given comment', () => {
      const [, update] = step().ignored('duplicate');

      expect(update).toEqual({ status: ReviewStatus.IGNORED, comment: 'duplicate' });
    });

    it('finish sets FINISHED', () => {
      const [, update] = step().finish();

      expect(update).toEqual({ status: ReviewStatus.FINISHED });
    });

    it('externalReview sets EXTERNAL_REVIEW', () => {
      const [, update] = step().externalReview();

      expect(update).toEqual({ status: ReviewStatus.EXTERNAL_REVIEW });
    });

    it('internalReview sets INTERNAL_REVIEW and stores the result', () => {
      const [, update] = step().internalReview({ b: 2 });

      expect(update).toEqual({ status: ReviewStatus.INTERNAL_REVIEW, result: '{"b":2}' });
    });

    it('onHold sets ON_HOLD', () => {
      const [, update] = step().onHold();

      expect(update).toEqual({ status: ReviewStatus.ON_HOLD });
    });

    it('manualReview sets MANUAL_REVIEW with comment and result', () => {
      const [, update] = step().manualReview('look', { c: 3 });

      expect(update).toEqual({ status: ReviewStatus.MANUAL_REVIEW, comment: 'look', result: '{"c":3}' });
    });
  });

  describe('result and comment handling', () => {
    it('getResult parses a JSON result', () => {
      expect(step({ result: '{"a":1}' }).getResult()).toEqual({ a: 1 });
    });

    it('getResult returns a non-JSON result verbatim', () => {
      expect(step({ result: 'plain-token' }).getResult()).toBe('plain-token');
    });

    it('getResult returns undefined when there is no result', () => {
      expect(step().getResult()).toBeUndefined();
    });

    it('setResult stringifies an object and keeps a string as-is', () => {
      expect(step().setResult({ a: 1 })).toBe('{"a":1}');
      expect(step().setResult('raw')).toBe('raw');
    });

    it('setResult leaves the stored result untouched when called with undefined', () => {
      const s = step({ result: 'kept' });

      expect(s.setResult(undefined)).toBe('kept');
      expect(s.result).toBe('kept');
    });

    it('addComment joins onto an existing comment and skips an empty one', () => {
      expect(step({ comment: 'first' }).addComment('second')).toBe('first;second');
      expect(step().addComment('only')).toBe('only');
    });
  });

  describe('reviewStatusForIdentLevel', () => {
    it('forces INTERNAL_REVIEW for a review-required step below LEVEL_30', () => {
      const s = step({ name: KycStepName.LEGAL_ENTITY, userData: userData({ kycLevel: KycLevel.LEVEL_20 }) });

      expect(s.reviewStatusForIdentLevel(ReviewStatus.COMPLETED)).toBe(ReviewStatus.INTERNAL_REVIEW);
    });

    it('keeps the fallback once the account reached LEVEL_30', () => {
      const s = step({ name: KycStepName.LEGAL_ENTITY, userData: userData({ kycLevel: KycLevel.LEVEL_30 }) });

      expect(s.reviewStatusForIdentLevel(ReviewStatus.COMPLETED)).toBe(ReviewStatus.COMPLETED);
    });

    it('keeps the fallback for a step that never requires review', () => {
      const s = step({ name: KycStepName.CONTACT_DATA, userData: userData({ kycLevel: KycLevel.LEVEL_0 }) });

      expect(s.reviewStatusForIdentLevel(ReviewStatus.COMPLETED)).toBe(ReviewStatus.COMPLETED);
    });
  });

  describe('resultData', () => {
    it('returns undefined without a result', () => {
      expect(step({ type: KycStepType.MANUAL }).resultData).toBeUndefined();
    });

    describe('sumsub', () => {
      const sumsubResult = (idDocs: unknown[], overrides: Record<string, unknown> = {}) =>
        JSON.stringify({
          data: { info: { idDocs }, ipCountry: 'CH', fixedInfo: { country: 'DE' } },
          webhook: { levelName: 'ch-standard', reviewResult: { reviewAnswer: ReviewAnswer.GREEN } },
          ...overrides,
        });

      it('maps the first document carrying a first name', () => {
        const s = step({
          type: KycStepType.SUMSUB_AUTO,
          result: sumsubResult([
            { firstName: null },
            {
              firstName: 'Jane',
              firstNameEn: 'Jane',
              lastNameEn: 'Doe',
              dob: '1990-01-02',
              country: 'CHE',
              number: 'X1',
              idDocType: IdDocType.ID_CARD,
            },
          ]),
        });

        expect(s.resultData).toEqual({
          type: IdentType.SUM_SUB,
          firstname: 'Jane',
          lastname: 'Doe',
          birthname: null,
          birthday: new Date('1990-01-02'),
          nationality: 'CHE',
          documentNumber: 'X1',
          documentType: IdentDocumentType.IDCARD,
          kycType: 'ch-standard',
          success: true,
          ipCountry: 'CH',
          country: 'DE',
        });
      });

      it('falls back to the first document when none carries a first name', () => {
        const s = step({
          type: KycStepType.SUMSUB_AUTO,
          result: sumsubResult([{ firstNameEn: 'First', lastNameEn: 'Doc' }]),
        });

        expect(s.resultData).toMatchObject({ firstname: 'First', lastname: 'Doc', birthday: undefined });
      });

      it('reports failure for a non-green review answer and survives missing idDocs', () => {
        const s = step({
          type: KycStepType.SUMSUB_VIDEO,
          result: JSON.stringify({
            data: { ipCountry: 'CH' },
            webhook: { levelName: 'ch-standard', reviewResult: { reviewAnswer: ReviewAnswer.RED } },
          }),
        });

        expect(s.resultData).toMatchObject({ success: false, firstname: undefined, country: undefined });
      });

      it('reports failure when the webhook carries no review result at all', () => {
        const s = step({
          type: KycStepType.SUMSUB_AUTO,
          result: JSON.stringify({ data: {}, webhook: { levelName: 'ch-standard' } }),
        });

        expect(s.resultData.success).toBe(false);
      });
    });

    it('maps a manual ident result', () => {
      const s = step({
        type: KycStepType.MANUAL,
        result: JSON.stringify({
          firstName: 'Jane',
          lastName: 'Doe',
          birthName: 'Roe',
          birthday: '1990-01-02',
          nationality: { symbol: 'CH' },
          documentType: IdentDocumentType.PASSPORT,
          documentNumber: 'P1',
        }),
      });

      expect(s.resultData).toEqual({
        type: IdentType.MANUAL,
        firstname: 'Jane',
        lastname: 'Doe',
        birthname: 'Roe',
        birthday: new Date('1990-01-02'),
        nationality: 'CH',
        documentType: IdentDocumentType.PASSPORT,
        documentNumber: 'P1',
        kycType: IdentType.MANUAL,
        success: true,
        ipCountry: null,
        country: null,
      });
    });

    it('maps a manual ident result without a nationality', () => {
      const s = step({
        type: KycStepType.MANUAL,
        result: JSON.stringify({ firstName: 'Jane', lastName: 'Doe', birthday: '1990-01-02' }),
      });

      expect(s.resultData.nationality).toBeUndefined();
    });

    it('maps an IdNow result', () => {
      const s = step({
        type: KycStepType.AUTO,
        result: JSON.stringify({
          userdata: {
            firstname: { value: 'Jane' },
            lastname: { value: 'Doe' },
            birthname: { value: 'Roe' },
            birthday: { value: '1990-01-02' },
            nationality: { value: 'CH' },
          },
          identificationdocument: { type: { value: IdentDocumentType.PASSPORT }, number: { value: 'P1' } },
          identificationprocess: { companyid: 'dfxauto', result: 'SUCCESS' },
        }),
      });

      expect(s.resultData).toEqual({
        type: IdentType.ID_NOW,
        firstname: 'Jane',
        lastname: 'Doe',
        birthname: 'Roe',
        birthday: new Date('1990-01-02'),
        nationality: 'CH',
        documentType: IdentDocumentType.PASSPORT,
        documentNumber: 'P1',
        kycType: 'dfxauto',
        success: true,
        ipCountry: null,
        country: null,
      });
    });

    it('accepts SUCCESS_DATA_CHANGED as an IdNow success', () => {
      const s = step({
        type: KycStepType.AUTO,
        result: JSON.stringify({ identificationprocess: { result: 'SUCCESS_DATA_CHANGED' } }),
      });

      expect(s.resultData.success).toBe(true);
    });

    it('reports a failed IdNow result and a null birthday when none is given', () => {
      const s = step({
        type: KycStepType.AUTO,
        result: JSON.stringify({ userdata: {}, identificationprocess: { result: 'FAILED' } }),
      });

      expect(s.resultData).toMatchObject({ success: false, birthday: null, firstname: undefined });
    });

    it('survives an IdNow result with no sections at all', () => {
      const s = step({ type: KycStepType.AUTO, result: JSON.stringify({}) });

      expect(s.resultData).toMatchObject({ success: false, kycType: undefined, documentType: undefined });
    });
  });

  describe('identDocumentId', () => {
    it('prefixes the document number with the organization name, stripped of spaces', () => {
      const s = step({
        type: KycStepType.MANUAL,
        result: JSON.stringify({ documentNumber: 'P1', birthday: '1990-01-02' }),
        userData: userData({ organizationName: 'Acme Corp AG' }),
      });

      expect(s.identDocumentId).toBe('AcmeCorpAGP1');
    });

    it('falls back to the bare document number for a personal account', () => {
      const s = step({
        type: KycStepType.MANUAL,
        result: JSON.stringify({ documentNumber: 'P1', birthday: '1990-01-02' }),
        userData: userData({}),
      });

      expect(s.identDocumentId).toBe('P1');
    });

    it('is undefined without a result', () => {
      expect(step({ type: KycStepType.MANUAL, userData: userData() }).identDocumentId).toBeUndefined();
    });
  });

  describe('userName', () => {
    it('joins the available name parts and trims them', () => {
      const s = step({
        type: KycStepType.MANUAL,
        result: JSON.stringify({ firstName: ' Jane ', lastName: 'Doe', birthName: 'Roe', birthday: '1990-01-02' }),
      });

      expect(s.userName).toBe('Jane Doe Roe');
    });

    it('skips missing parts', () => {
      const s = step({
        type: KycStepType.MANUAL,
        result: JSON.stringify({ firstName: 'Jane', lastName: 'Doe', birthday: '1990-01-02' }),
      });

      expect(s.userName).toBe('Jane Doe');
    });

    it('is undefined without a result', () => {
      expect(step({ type: KycStepType.MANUAL }).userName).toBeUndefined();
    });
  });

  describe('isValidCreatingBankData', () => {
    const validStep = () =>
      step({
        name: KycStepName.IDENT,
        status: ReviewStatus.COMPLETED,
        type: KycStepType.MANUAL,
        result: JSON.stringify({ firstName: 'Jane', lastName: 'Doe', documentNumber: 'P1', birthday: '1990-01-02' }),
        userData: userData({
          status: UserDataStatus.ACTIVE,
          kycLevel: KycLevel.LEVEL_30,
          kycType: KycType.DFX,
        }),
      });

    it('accepts a completed DFX ident step at LEVEL_30 with a document and a name', () => {
      expect(validStep().isValidCreatingBankData).toBe(true);
    });

    it('rejects a step that is not an ident step', () => {
      const s = validStep();
      s.name = KycStepName.PERSONAL_DATA;

      expect(s.isValidCreatingBankData).toBe(false);
    });

    it('rejects an ident step that is not completed', () => {
      const s = validStep();
      s.status = ReviewStatus.IN_PROGRESS;

      expect(s.isValidCreatingBankData).toBe(false);
    });

    it('rejects a merged account', () => {
      const s = validStep();
      s.userData.status = UserDataStatus.MERGED;

      expect(s.isValidCreatingBankData).toBe(false);
    });

    it('rejects an account below LEVEL_30', () => {
      const s = validStep();
      s.userData.kycLevel = KycLevel.LEVEL_20;

      expect(s.isValidCreatingBankData).toBe(false);
    });

    it('rejects a non-DFX kyc type', () => {
      const s = validStep();
      s.userData.kycType = KycType.LOCK;

      expect(s.isValidCreatingBankData).toBe(false);
    });

    // KNOWN DEFECT, pinned rather than asserted as correct: `identDocumentId` interpolates
    // `data.documentNumber` into a template literal, so a missing number yields the string
    // "undefined" — which is truthy and lets this gate pass. `documentNumber` is optional-chained
    // for both sumsub and IdNow results, so the case is reachable. Fixing it changes behaviour
    // beyond a coverage change and belongs in its own PR; this test records today's behaviour so
    // that a fix has to come here and flip it deliberately.
    it('does NOT reject a step without a document number (identDocumentId yields the string "undefined")', () => {
      const s = validStep();
      s.result = JSON.stringify({ firstName: 'Jane', lastName: 'Doe', birthday: '1990-01-02' });

      expect(s.identDocumentId).toBe('undefined');
      expect(s.isValidCreatingBankData).toBe(true);
    });

    it('rejects a step whose result carries no name', () => {
      const s = validStep();
      s.result = JSON.stringify({ documentNumber: 'P1', birthday: '1990-01-02' });

      expect(s.isValidCreatingBankData).toBeFalsy();
    });
  });

  describe('type getters', () => {
    it('recognises both sumsub variants', () => {
      expect(step({ type: KycStepType.SUMSUB_AUTO }).isSumsub).toBe(true);
      expect(step({ type: KycStepType.SUMSUB_VIDEO }).isSumsub).toBe(true);
      expect(step({ type: KycStepType.MANUAL }).isSumsub).toBe(false);
    });

    it('distinguishes the sumsub video variant', () => {
      expect(step({ type: KycStepType.SUMSUB_VIDEO }).isSumsubVideo).toBe(true);
      expect(step({ type: KycStepType.SUMSUB_AUTO }).isSumsubVideo).toBe(false);
    });

    it('recognises the manual type', () => {
      expect(step({ type: KycStepType.MANUAL }).isManual).toBe(true);
      expect(step({ type: KycStepType.AUTO }).isManual).toBe(false);
    });
  });

  describe('toJSON', () => {
    it('drops userData to break the circular reference back to the account', () => {
      const json = step({ name: KycStepName.PERSONAL_DATA, userData: userData({ id: 7 }) }).toJSON();

      expect(json.userData).toBeUndefined();
      expect(json).toMatchObject({ id: 42, name: KycStepName.PERSONAL_DATA });
    });
  });

  // The decorator callbacks are only invoked by TypeORM when it builds its metadata, so a spec that
  // never touches them leaves the declarations untested. Reading them back out of the metadata
  // storage and calling them asserts the schema the entity declares. Same approach as
  // aktionariat-registration.entity.spec.ts.
  describe('schema declarations', () => {
    it('declares the unique index that keeps one row per attempt of a step', () => {
      const index = getMetadataArgsStorage().indices.find(
        (i) => i.target === KycStep && typeof i.columns === 'function',
      );

      expect(index).toBeDefined();
      expect(index!.unique).toBe(true);
      expect(
        (index!.columns as (s: unknown) => unknown[])({
          userData: 'USER_DATA',
          name: 'NAME',
          type: 'TYPE',
          sequenceNumber: 'SEQ',
        }),
      ).toEqual(['USER_DATA', 'NAME', 'TYPE', 'SEQ']);
    });

    it('declares a required ManyToOne relation to UserData, inverse of its kycSteps', () => {
      const relation = getMetadataArgsStorage().relations.find(
        (r) => r.target === KycStep && r.propertyName === 'userData',
      );

      expect(relation).toBeDefined();
      expect(relation!.relationType).toBe('many-to-one');
      expect((relation!.type as () => unknown)()).toBe(UserData);
      expect((relation!.inverseSideProperty as (u: UserData) => unknown)({ kycSteps: 'STEPS' } as never)).toBe('STEPS');
      expect(relation!.options.nullable).toBe(false);
    });

    it.each([
      ['logs', 'one-to-many', StepLog, 'kycStep'],
      ['files', 'one-to-many', KycFile, 'kycStep'],
      ['recommendation', 'one-to-one', Recommendation, 'kycStep'],
    ])('declares the %s relation back to this step', (propertyName, relationType, target, inverseProperty) => {
      const relation = getMetadataArgsStorage().relations.find(
        (r) => r.target === KycStep && r.propertyName === propertyName,
      );

      expect(relation).toBeDefined();
      expect(relation!.relationType).toBe(relationType);
      expect((relation!.type as () => unknown)()).toBe(target);
      expect((relation!.inverseSideProperty as (o: unknown) => unknown)({ [inverseProperty]: 'STEP' })).toBe('STEP');
    });
  });
});
