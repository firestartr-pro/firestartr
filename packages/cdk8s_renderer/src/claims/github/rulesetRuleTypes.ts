// Rule types accepted by prefapp/tfm//modules/github-org-ruleset. Keep in sync
// with the rule type validation in that module's variables.tf.
export const RULESET_RULE_TYPES = [
  'creation',
  'deletion',
  'update',
  'non_fast_forward',
  'required_linear_history',
  'required_signatures',
  'pull_request',
  'required_status_checks',
  'commit_message_pattern',
  'commit_author_email_pattern',
  'committer_email_pattern',
  'branch_name_pattern',
  'tag_name_pattern',
  'copilot_code_review',
  'file_path_restriction',
  'file_extension_restriction',
  'max_file_size',
  'max_file_path_length',
];
