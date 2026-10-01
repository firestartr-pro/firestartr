# Deploying workloads

![Infrastructure repositories feed declarative inputs into Firestartr, which scaffolds code repositories and hydrates state repositories; code repositories publish images to the registry, and ArgoCD applies the state repositories through the Kubernetes API Machinery, where Firestartr watches custom resources, producing Kubernetes workloads, managed infrastructure, and resources in other cloud providers](./images/deploying-workloads.png)

Firestartr turns what you declare in your infrastructure repositories (claims, the `.firestartr` configuration and features) into running workloads. It scaffolds the code repositories where your applications live, and hydrates the state repositories that describe what each environment should run. When a code repository publishes a new image, its state repository gets the new version, and ArgoCD applies that state to the cluster through the Kubernetes API. Kubernetes then runs the workloads, while Firestartr provisions the managed infrastructure and the resources in other cloud providers that the state declares.

The guides below explain how to configure Firestartr, how state repositories are organized, and how to move older repositories to the current structure.

---

## Configuration

### [The .firestartr Repository](./The-dot-firestartr-repository.md)
Complete guide to the `.firestartr` configuration repository that every Firestartr client should have. Documents the repository structure including app configurations, Docker registries, platforms, providers, and validation policies with detailed field descriptions and examples.

---

## Repository Structures

### [State Apps Repository](./state-apps-repository.md)
Documentation on application repositories for deploying workloads in Kubernetes. Covers the directory structure for both `main` and `deployment` branches, automatic image updates, on-demand deployments, ArgoCD integration with ApplicationSet, notification system setup, and platform control through Argo Projects.

### [State Sys-Services Repository](./state-sys-services-repository.md)
Guide to managing system services for Kubernetes clusters (sys-services). Explains the repository structure for critical components like ingress controllers and configuration utilities, the `main` and `deployment` branch organization, and how ApplicationSets and AppProjects provide granular control per sys-service.

---

## Migration Guides

### [Migrating to Our New App State Repo Structure](./Migrating-to-our-new-app-state-repo-structure.md)
Step-by-step migration guide for transitioning old state repositories to the new application state repository structure. Includes prerequisites, creating new repos, updating charts, configuring `.firestartr`, updating `make_dispatches`, creating Argo projects and application sets, uninstalling old releases, rendering deployments, verification steps, and cleanup procedures. Also covers special cases like leaving production dispatching to old repos, updating namespaces, and migrating secrets.

---

## Quick Links

- **Features Documentation**: [Our Features](/docs/features/)
- **.firestartr Config**: [The .firestartr Repository](./The-dot-firestartr-repository.md)
- **App Deployments**: [State Apps Repository](./state-apps-repository.md)
- **Sys Services**: [State Sys-Services Repository](./state-sys-services-repository.md)
- **Migration Guide**: [Migrating to New Structure](./Migrating-to-our-new-app-state-repo-structure.md)
