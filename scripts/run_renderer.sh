BASE_DIR=/library/packages/cdk8s_renderer/__tests__/fixtures

lerna run cli --scope @firestartr/cli -- cdk8s \
                    --render \
                    --globals "$BASE_DIR/globals" \
                    --initializers "$BASE_DIR/initializers" \
                    --claims "$BASE_DIR/claims" \
                    --previousCRs "$BASE_DIR/crs" \
                    --excludePath "$BASE_DIR/crs/.github" \
                    --claimsDefaults "$BASE_DIR/initializers" \
                    --disableRenames \
                    --provider github
