
aws s3 cp --recursive ./ s3://aol.cognotik.com/ \
  --exclude "node_modules/*" \
  --exclude "test/*" \
  --exclude "public/*" \
  --exclude "docs/*" \
  --exclude "scripts/*" \
  --exclude "package.json" \
  --exclude "package-lock.json" \
  --exclude "tsconfig.json" \
  --exclude "webpack.config.js" \
  --exclude ".git/*" \
  --exclude "android-twa/*" \
  --exclude "terraform/*" \
  --exclude "*.sh" \
  --exclude "LICENSE"
