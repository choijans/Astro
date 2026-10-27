// @ts-check
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['eslint.config.mjs'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: 'commonjs',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      "prettier/prettier": ["error", { endOfLine: "auto" }],
    },
  },
  {
    // Supertest's `response.body` (and a mocked Prisma/BullMQ call's return
    // value) is typed `any`, so every `res.body.foo` or `(mock.fn as
    // jest.Mock).mock.calls[...]` access in a test trips the no-unsafe-*
    // family — ~126 call sites across these files, each already behind an
    // explicit `request(...).expect(200)`/a typed `makeCommand()` fixture
    // that's the actual source of truth, so a typed-response helper at every
    // call site would just move the same `any` cast around without adding
    // real safety. Relaxed for tests only, not production code.
    //
    // unbound-method is the same shape of false positive here: it exists to
    // catch a *real* class method torn off its instance and losing `this`
    // (e.g. `const f = obj.realMethod; f()`), but every occurrence in this
    // codebase is `expect(mock.someMethod).toHaveBeenCalledWith(...)` against
    // a plain `{ someMethod: jest.fn() }` object cast with `as unknown as
    // X` — a `jest.fn()` never uses `this`, so the rule has nothing real to
    // protect against here, only the declared (production) type it's cast to.
    files: ['**/*.spec.ts', '**/*.e2e-spec.ts', 'test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/unbound-method': 'off',
    },
  },
);
