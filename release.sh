#!/usr/bin/env bash

# Builds the docker image meeting-timer:<version>, where the version is the date and time, and tags the commit it was
# built from with the version. See "Releasing" in README.md.

set -e

function info() {
  echo "$(date +"%T") INFO :" "$@"
}

function die() {
  echo "$(date +"%T") ERROR:" "$@"
  exit 1
}

cd "$(realpath "$(dirname "${0}")")"

version=$(date +%Y-%m-%d-%H%M)

git diff --quiet HEAD || die "There are uncommitted changes. Commit them first, so the image matches the tag ${version}."
! git rev-parse -q --verify "refs/tags/${version}" >/dev/null || die "The tag ${version} already exists."

info "Building meeting-timer:${version}"
docker build --build-arg VERSION="${version}" -t "meeting-timer:${version}" .

git tag -a "${version}" -m "Release ${version}"
info "Built meeting-timer:${version} and tagged the commit with ${version}."
info "Push the tag with: git push origin ${version}"
