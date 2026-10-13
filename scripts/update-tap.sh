#!/usr/bin/env bash
# Rewrites Formula/codeatlas.rb in codeatlasdev/homebrew-tap for the current version.
# Needs GH_TOKEN with write access to the tap and bin-dist/SHA256SUMS from build-binaries.sh.
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION="$(node -p "require('./package.json').version")"
sum() { grep "codeatlas-$VERSION-$1.tar.gz" bin-dist/SHA256SUMS | cut -d' ' -f1; }
tmp="$(mktemp -d)"
gh repo clone codeatlasdev/homebrew-tap "$tmp" -- -q
cat > "$tmp/Formula/codeatlas.rb" <<RUBY
class Codeatlas < Formula
  desc "CLI for the public CodeAtlas API (services catalog)"
  homepage "https://codeatlas.com.br"
  license "MIT"

  on_macos do
    on_arm do
      url "https://github.com/codeatlasdev/codeatlas-sdk-js/releases/download/v#{version}/codeatlas-#{version}-darwin-arm64.tar.gz"
      sha256 "$(sum darwin-arm64)"
    end
    on_intel do
      url "https://github.com/codeatlasdev/codeatlas-sdk-js/releases/download/v#{version}/codeatlas-#{version}-darwin-x64.tar.gz"
      sha256 "$(sum darwin-x64)"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/codeatlasdev/codeatlas-sdk-js/releases/download/v#{version}/codeatlas-#{version}-linux-arm64.tar.gz"
      sha256 "$(sum linux-arm64)"
    end
    on_intel do
      url "https://github.com/codeatlasdev/codeatlas-sdk-js/releases/download/v#{version}/codeatlas-#{version}-linux-x64.tar.gz"
      sha256 "$(sum linux-x64)"
    end
  end

  def install
    bin.install "codeatlas"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/codeatlas --version")
  end
end
RUBY
cd "$tmp"
git add Formula/codeatlas.rb
git diff --cached --quiet && exit 0
git -c user.name="codeatlas-release" -c user.email="contato@codeatlas.com.br" commit -qm "codeatlas $VERSION"
git push -q
