# Installs, tests and builds meeting-timer. The server can also be run directly in server/, see README.md.
# A release (a docker image tagged with the version, and a git tag) is made with release.sh, also via "make release".

.PHONY: all install test image release

all: test

install:
	cd server && npm ci

test: install
	cd server && npm test

# The docker image, without a version tag. For a release use "make release".
image:
	docker build .

release:
	./release.sh
