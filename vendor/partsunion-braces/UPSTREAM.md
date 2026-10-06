# Upstream provenance and local patch

This package is a scoped Partsunion fork of the upstream `braces@3.0.3` npm package. The source was copied from the immutable npm tarball `https://registry.npmjs.org/braces/-/braces-3.0.3.tgz` with SRI SHA-512 `sha512-yQbXgO/OSZVD2IsiLlro+7Hf6Q18EJrKSEsdoMzKePKXct3gvD8oLcOQdIzGupr5Fj+EDe8gO/lxc1BzfMpxvA==`. The upstream MIT `LICENSE` file is retained.

Local changes add a maximum recursive group nesting depth of 100 before parsing can hand input to recursive walkers, plus iterative AST depth checks at the public `compile`, `expand`, and `stringify` entry points so caller-provided ASTs cannot bypass the limit. The scoped package version `3.0.3-partsunion.1` identifies this local fork; it does not claim an upstream `braces` release.

The guard addresses GHSA-vfj7-8cjw-p6xm / CVE-2026-93687. The upstream advisory lists no patched release. Regression coverage exercises the public APIs and installed transitive paths through `chokidar` and `micromatch`.

The fork also removes the upstream close-node debug log from compilation. Pattern content must not be printed to consumer or CI logs. The fork is installed from this versioned source tree; release source commits and artifact hashes bind its exact bytes.
