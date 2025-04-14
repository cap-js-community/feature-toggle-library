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

## CDS and local dependencies

Ideally, we would want to mount our library as a `file:` dependency in this sample project. Unfortunately CDS does not
handle `file:` dependencies correctly, because they are realized through symlinks.

To circumvent this, we now copy the required file at runtime into the dependencies of the sample project. See the
`copy-library` task in [package.json](./package.json). This step is not necessary when installing our library normally.
We do it here, so that new library code can be manually tested in this little sample project, without being released.
