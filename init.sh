export PWA_URL=https://aol.cognotik.com/
export ANDROID_APP_ID=com.cognotik.arcadeoflife
#npm run build:play:init    # first time only

export ANDROID_HOME="$HOME/.bubblewrap/android_sdk"
unset ANDROID_SDK_ROOT
npm run build:play:build   # subsequent builds
