# Example CAP Server

## Node and local dependencies

In [package.json](./package.json), we declare our library as a local `file:` dependency. There is a bug in node where
such local dependencies cause imports _from the local dependency's code_ to fail, because of the way symlinks are
handled. For details see https://github.com/nodejs/node/issues/3402.

To fix this behavior, you need to run `node` with the option `--preserve-symlinks`.
