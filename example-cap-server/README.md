# Example CAP Server

## CDS and local dependencies

Ideally, we would want to mount our library as a `file:` dependency in this sample project. Unfortunately CDS does not
handle `file:` dependencies correctly, because they are realized through symlinks.
https://github.tools.sap/cap/issues/issues/14395

To circumvent this, we now copy the required file at runtime into the dependencies of the sample project. See the
`copy-library` task in [package.json](./package.json). This step is not necessary when installing our library normally.
We do it here, so that new library code can be manually tested in this little sample project, without being released.
