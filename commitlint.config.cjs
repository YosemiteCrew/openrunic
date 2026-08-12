module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      [
        'build',
        'chore',
        'ci',
        'docs',
        'feat',
        'fix',
        'perf',
        'refactor',
        'revert',
        'style',
        'test',
      ],
    ],
    // Scope is required at the PR level by pr-governance.yml, which reads this
    // list at runtime so the two gates can never drift.
    'scope-enum': [
      2,
      'always',
      ['web', 'api', 'database', 'fhir', 'types', 'lib', 'repo', 'ci', 'docs'],
    ],
    'subject-case': [0],
    'header-max-length': [2, 'always', 100],
  },
};
