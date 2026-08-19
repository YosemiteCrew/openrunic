# @openrunic/types

Shared primitive types for the Openrunic monorepo: the `OpenrunicEnvironment` union (with
`OPENRUNIC_ENVIRONMENTS` and the `isOpenrunicEnvironment` guard), branded `UUID` and `ISODateTime`
string types with their `isUuid` / `isIsoDateTime` guards, and a `Result<T, E>` discriminated union
with `ok()` / `err()` helpers for fallible operations. Zero runtime dependencies. Everything here
is either a type or a tiny pure function, safe to import from any app or package.
