import { gql } from 'graphql-request';

export const getAccountSummaryQuery = (address: string) => gql`
query AccountSummary {
  account(id: "${address.toLowerCase()}") {
    address
    addressType
    balance
    lastUpdated
    historicalBalances(limit: 20, orderBy: "timestamp", orderDirection: "asc") {
      items {
        balance
        timestamp
      }
    }
  }
}
`;

export const getAccountHistoryQuery = (address: string, first?: number, after?: string) => {
  const limit = first || 50;
  const afterClause = after ? `, after: "${after}"` : '';

  return gql`
    query AccountHistory {
      account(id: "${address.toLowerCase()}") {
        address
        addressType
        history(orderBy: "timestamp", orderDirection: "desc", limit: ${limit}${afterClause}) {
          items {
            timestamp
            eventType
            txHash
            addressTypeUpdate {
              addressType
            }
            approval {
              spender
              value
            }
            tokensDeclaredInvalid {
              amount
              message
            }
            transfer {
              from
              to
              value
            }
          }
          totalCount
          pageInfo {
            endCursor
            hasNextPage
            hasPreviousPage
            startCursor
          }
        }
      }
    }
  `;
};

export const getHoldersQuery = (first?: number, before?: string, after?: string) => {
  const limit = first || 50;
  const beforeClause = before ? `, before: "${before}"` : '';
  const afterClause = after ? `, after: "${after}"` : '';

  return gql`
    query HoldersInformationPaginated {
    totalSupplys(limit: 1, orderBy: "timestamp", orderDirection: "desc") {
      items {
        value
      }
    }
      accounts(where: { balance_gt: "0" }, orderBy: "balance", orderDirection: "desc", limit: ${limit}${beforeClause}${afterClause}) {
        items {
          address
          balance
        }
        pageInfo {
          endCursor
          hasNextPage
          hasPreviousPage
          startCursor
        }
        totalCount
      }
    }
  `;
};

export const getTokenInfoQuery = () => gql`
  query TokenInfo {
    changeTotalShares(limit: 1, orderBy: "timestamp", orderDirection: "desc") {
      items {
        total
        timestamp
        txHash
      }
    }
    totalSupplys(limit: 1, orderBy: "timestamp", orderDirection: "desc") {
      items {
        value
        timestamp
      }
    }
  }
`;
