package main

type E2EConfig struct {
	Org string `yaml:"org"`

	Customer string `yaml:"customer"`

	Cluster string `yaml:"cluster"`

	Operator E2EConfigOperator `yaml:"operator"`

	Credentials E2EConfigCredentials `yaml:"credentials"`
}

type E2EConfigOperator struct {
    ChartVersion string `yaml:"chartVersion"`

    ImageTag string `yaml:"imageTag"`
    
    // ImageName allows specifying the image repository/name (without tag).
    // Example: "ghcr.io/firestartr-pro/firestartr".
    // When set, this repository/name will be passed to the upstream
    // PrepareOperator/GetConfig alongside ImageTag so callers can control
    // the repository separately from the tag.
    ImageName string `yaml:"imageName"`

	MaxSlots string `yaml:"maxSlots"`
}

type E2EConfigCredentials struct {
	Region string `yaml:"region"`
}
