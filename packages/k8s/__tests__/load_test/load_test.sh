#!/bin/bash

if [ $# -lt 1 ]; then
  echo "Usage: $0 <n>"
  exit 1
fi

N="$1"
TEMPLATE_FILE="$2"


kubectl apply -f ../fixtures/groups
kubectl apply -f ../fixtures/memberships
# Apply the updated template n times
for ((i=1; i<=N; i++)); do
  # Generate a new name following Kubernetes metadata.name format
  NEW_NAME="firestartr-$(date +%s | tr -d '-').$(head /dev/urandom | tr -dc 'a-z0-9' | head -c 8)"

  UUID_KEY="$(uuidgen)"

  # Check if the artifact exists
  if kubectl get firestartrgithubgroup "$NEW_NAME" &> /dev/null; then
    echo "Artifact with name $NEW_NAME already exists. Skipping apply."
    exit 0
  fi

  if kubectl get firestartrgithubrepository "$NEW_NAME" &> /dev/null; then
    echo "Artifact with name $NEW_NAME already exists. Skipping apply."
    exit 0
  fi

  # Replace METADATA_NAME with the new name
  sed "s/METADATA_NAME/$NEW_NAME/g" "$TEMPLATE_FILE" > /tmp/updated_template.yaml

  sed -i "s/UUID_KEY/$UUID_KEY/g" /tmp/updated_template.yaml

  kubectl apply -f /tmp/updated_template.yaml

  cat /tmp/updated_template.yaml | grep tfStateKey
  # Clean up the temporary file
  rm /tmp/updated_template.yaml
done
