import { gql } from 'graphql-request';

export const accountSummaryQuery = gql`
  query AccountSummary($id: String!) {
    account(id: $id) {
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

export const accountHistoryQuery = gql`
  query AccountHistory($id: String!, $limit: Int!, $after: String) {
    account(id: $id) {
      address
      addressType
      history(orderBy: "timestamp", orderDirection: "desc", limit: $limit, after: $after) {
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

export const holdersQuery = gql`
  query HoldersInformationPaginated($limit: Int!, $before: String, $after: String) {
    totalSupplys(limit: 1, orderBy: "timestamp", orderDirection: "desc") {
      items {
        value
      }
    }
    accounts(
      where: { balance_gt: "0" }
      orderBy: "balance"
      orderDirection: "desc"
      limit: $limit
      before: $before
      after: $after
    ) {
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

export const tokenInfoQuery = gql`
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
