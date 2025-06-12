# Example CAP Server

## Content

| Topic                        | Path(s)                                                      |
| :--------------------------- | :----------------------------------------------------------- |
| CDS-Plugin Configuration     | [package.json](./package.json)                               |
| CDS Configuration            | [.cdsrc.json](./.cdsrc.json)                                 |
| Feature Toggle Configuration | [srv/feature/toggles.yaml](./srv/feature/toggles.yaml)       |
| Feature Service Calls        | [http/feature-service.http](./http/feature-service.http)     |
| Check Service Calls          | [http/check-service.http](./http/check-service.http)         |
| CAP Feature Toggle           | [fts/check-service-extension](./fts/check-service-extension) |

## CDS-DK with npx

The build time tooling of cds is too ambivalent for regular npx usage. This is how you can still use it with `npx`

```
npx --package=@sap/cds-dk -- cds
```
