// --- PARAMETERS --- //
@description('Deployment environment')
param env string

@description('Name of the front doors WAF policy')
param wafName string

@description('Tags to be applied to all resources')
param tags object = {}

// --- RESOURCES --- //
resource firewallPolicies 'Microsoft.Network/frontdoorwebapplicationfirewallpolicies@2024-02-01' = if (env != 'loc') {
  name: wafName
  location: 'Global'
  tags: tags
  sku: {
    name: 'Premium_AzureFrontDoor'
  }
  properties: {
    policySettings: {
      enabledState: 'Enabled'
      mode: 'Detection'
      requestBodyCheck: 'Enabled'
      javascriptChallengeExpirationInMinutes: 30
    }
    customRules: {
      rules: [
        {
          name: 'RateLimit'
          enabledState: 'Enabled'
          priority: 100
          ruleType: 'RateLimitRule'
          rateLimitDurationInMinutes: 5
          rateLimitThreshold: 1000
          matchConditions: [
            {
              matchVariable: 'RequestHeader'
              selector: 'Host'
              operator: 'GreaterThanOrEqual'
              negateCondition: false
              matchValue: [
                '0'
              ]
              transforms: []
            }
          ]
          action: 'Block'
          groupBy: [
            {
              variableName: 'SocketAddr'
            }
          ]
        }
      ]
    }
    managedRules: {
      managedRuleSets: [
        {
          ruleSetType: 'Microsoft_DefaultRuleSet'
          ruleSetVersion: '2.1'
          ruleSetAction: 'Block'
          ruleGroupOverrides: [
            {
              ruleGroupName: 'RCE'
              rules: [
                {
                  ruleId: '932105'
                  enabledState: 'Disabled'
                  action: 'AnomalyScoring'
                  exclusions: []
                }
                {
                  ruleId: '932100'
                  enabledState: 'Disabled'
                  action: 'AnomalyScoring'
                  exclusions: []
                }
                {
                  ruleId: '932110'
                  enabledState: 'Disabled'
                  action: 'AnomalyScoring'
                  exclusions: []
                }
                {
                  ruleId: '932115'
                  enabledState: 'Disabled'
                  action: 'AnomalyScoring'
                  exclusions: []
                }
              ]
              exclusions: []
            }
            {
              ruleGroupName: 'SQLI'
              rules: [
                {
                  ruleId: '942200'
                  enabledState: 'Disabled'
                  action: 'AnomalyScoring'
                  exclusions: []
                }
                {
                  ruleId: '942450'
                  enabledState: 'Disabled'
                  action: 'AnomalyScoring'
                  exclusions: []
                }
                {
                  ruleId: '942340'
                  enabledState: 'Disabled'
                  action: 'AnomalyScoring'
                  exclusions: []
                }
                {
                  ruleId: '942370'
                  enabledState: 'Disabled'
                  action: 'AnomalyScoring'
                  exclusions: []
                }
              ]
              exclusions: []
            }
            {
              ruleGroupName: 'MS-ThreatIntel-SQLI'
              rules: [
                {
                  ruleId: '99031004'
                  enabledState: 'Disabled'
                  action: 'AnomalyScoring'
                  exclusions: []
                }
              ]
              exclusions: []
            }
          ]
          exclusions: []
        }
        {
          ruleSetType: 'Microsoft_BotManagerRuleSet'
          ruleSetVersion: '1.0'
          ruleGroupOverrides: [
            {
              ruleGroupName: 'UnknownBots'
              rules: [
                {
                  ruleId: 'Bot300700'
                  enabledState: 'Disabled'
                  action: 'Log'
                  exclusions: []
                }
                {
                  ruleId: 'Bot300300'
                  enabledState: 'Disabled'
                  action: 'Log'
                  exclusions: []
                }
              ]
              exclusions: []
            }
          ]
          exclusions: []
        }
      ]
    }
  }
}
