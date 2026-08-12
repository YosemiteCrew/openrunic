export default {
  '**/*.{ts,tsx,js,jsx,mjs,cjs,json,md,css,scss,yml,yaml}': ['prettier --write'],
  // Wide net for secret scanning — includes config and env-shaped files that
  // prettier never touches.
  '**/*.{ts,tsx,js,jsx,mjs,cjs,json,md,yml,yaml,sh,env,toml,properties,xml,gradle,plist}': [
    'secretlint --no-gitignore --maskSecrets',
  ],
};
