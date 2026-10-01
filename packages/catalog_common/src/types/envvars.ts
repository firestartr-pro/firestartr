/**
 * !NOTICE
 *
 * This is a list of the environment variables used from CLI and it's subcommands,
 * they must be defined with the same key and value, with a commentary explaining
 * the meaning of each one, so every developer who needs one of this variables can
 * cehck easily if there is already one with the same funcion, avoiding to create
 * "duplicated" environment variables.
 */
export enum envVars {
  // ---- CATALOG LOCATION VARIALBES ------------------------------------------
  catalogMainSate = 'CATALOG_MAIN_STATE', // Current catalog path
  catalogDesiredState = 'CATALOG_DESIRED_STATE', // Future catalog path
  catalogDeletionsState = 'CATALOG_DELETIONS_STATE', // Deletions catalog path
  catalogScaffoldings = 'CATALOG_SCAFFOLDINGS', // Path for catalog's scaffoldings
  // ---- GITHUB AUTH VARIABLES -----------------------------------------------
  token = 'TOKEN', // Github's PAT
  tokenPrefapp = 'TOKEN_PREFAPP', // Github's PAT
  // ---- IMPORTER VARIABLES --------------------------------------------------
  defaultSystem = 'FIRESTARTR_DEFAULT_SYSTEM', // Set the default system name
  defaultOwner = 'DEFAULT_OWNER', // Default owner for artifacts imported
  fullOrgGroup = 'FULL_ORG_GROUP', // Custom full organization name
  nobodyGroup = 'NOBODY_GROUP', // Custom nobody group name
  platformGroup = 'PLATFORM_GROUP', // Custom platform group name
  org = 'ORG', // Organization name
  // ---- TERRAFORM/S3 VARIABLES ----------------------------------------------
  awsAccesKey = 'AWS_ACCESS_KEY_ID',
  awsAccesSecretKey = 'AWS_SECRET_ACCESS_KEY',
  s3Bucket = 'S3_BUCKET', // Terraform state storage bucket
  s3Lock = 'S3_LOCK', // DynamoDB table for locks
  s3Region = 'S3_REGION', // Region of the AWS resource
  exclusionsYamlPath = 'EXCLUSIONS_PATH', // Path for exclusions.yaml
  // ---- GITHUB APP VARIABLES -----------------------------------------------
  githubAppId = 'GITHUB_APP_ID',
  githubAppInstallationId = 'GITHUB_APP_INSTALLATION_ID',
  githubAppInstallationIdPrefapp = 'GITHUB_APP_INSTALLATION_ID_PREFAPP',
  githubAppPemFile = 'GITHUB_APP_PEM_FILE',
  // ---- PREFAPP BOT VARIABLES -----------------------------------------------
  githubAppPatPrefapp = 'PREFAPP_BOT_PAT',
  // ---- GENERAL CLI VARIABLES -----------------------------------------------
  firestartrImageKind = 'FIRESTARTR_IMAGE_KIND', // to check whether is full or slim
  // ---- OPERATOR VARIABLES -----------------------------------------------
  operatorNamespace = 'OPERATOR_NAMESPACE', // Operator namespace
  operatorKindList = 'OPERATOR_KIND_LIST', // Operator kind list
  operatorDummyExec = 'OPERATOR_DUMMY_EXEC',
  operatorIgnoreLease = 'OPERATOR_IGNORE_LEASE', // Operator dummy exec
  operatorDeploymentName = 'OPERATOR_DEPLOYMENT_NAME', // Operator deployment name
  operatorNumberOfMaxSlots = 'OPERATOR_NUMBER_OF_MAX_SLOTS', // Number of max slots for the operator to process items in parallel
  // ---- KUBERNETES VARIABLES -----------------------------------------------
  kubernetesServiceHost = 'KUBERNETES_SERVICE_HOST',
  kubernetesServicePort = 'KUBERNETES_SERVICE_PORT',
  // ---- CRS STATUS SERVICE VARIABLES ---------------------------------------
  crsStatusTombstoneTtl = 'CRS_STATUS_TOMBSTONE_TTL',
  crsStatusPort = 'CRS_STATUS_PORT',
  crsStatusKindList = 'CRS_STATUS_KIND_LIST',
  crsStatusNamespace = 'CRS_STATUS_NAMESPACE',
  crsStatusApiGroup = 'CRS_STATUS_API_GROUP',
  crsStatusApiVersion = 'CRS_STATUS_API_VERSION',
}
