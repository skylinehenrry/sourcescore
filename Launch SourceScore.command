#!/bin/zsh
cd -- "$(dirname "$0")"
if [[ ! -d releases/SourceScore.app ]]; then
  print 'The app has not been packaged yet. Run npm run desktop:build in this folder.'
  exit 1
fi
open "$PWD/releases/SourceScore.app"
