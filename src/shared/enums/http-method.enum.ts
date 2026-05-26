// HTTP request methods used across structured action / endpoint DTOs.
// String-valued so the enum serialises to the wire as `'GET'`, `'POST'`, …
// matching standard HTTP verb casing.
export enum HttpMethod {
  GET = 'GET',
  POST = 'POST',
  PUT = 'PUT',
  DELETE = 'DELETE',
  PATCH = 'PATCH',
}
