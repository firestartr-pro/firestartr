#!/bin/bash

# Get the directory to search
dir_to_search=$1

# Find all .ts files in the directory
find "$dir_to_search" -type f -name "*.ts" | while read -r ts_file; do
  # Remove the .ts extension
  base_name="${ts_file%.*}"

  # If .js and .d.ts versions of the file exist, remove them
  [[ -f "$base_name.js" ]] && rm "$base_name.js"
  [[ -f "$base_name.d.ts" ]] && rm "$base_name.d.ts"
done
