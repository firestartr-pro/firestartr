files:
    {{| #ADDITIONAL_FILES |}}
    - src: additional/{{| . |}}
      dest: {{| . |}}
      upgradable: false
    {{| /ADDITIONAL_FILES |}}
