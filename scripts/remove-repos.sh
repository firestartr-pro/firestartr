#!/bin/bash

# Set the repository owner and name
owner="firestartr-test"
max_repos=300

# Get the list of workflow runs
workflow_runs=$(gh repo list firestartr-test -L $max_repos | awk '{print $1}')

for repo in $workflow_runs; do
    # if repo name starts with firestartr-, delete it
    if [[ $repo == firestartr-test/test-* ]]; then
        echo "Deleting $repo"
        gh repo delete $repo --yes
    fi
done
