# Importer uses two-phase gather/decant Decanters

The importer is built as Decanters that run in two distinct phases: an async
Gather phase (`__gather*`) fetches external GitHub data onto the Decanter
instance, then a Decant phase (`__decant*`) turns that gathered data into
claim/CR patch operations. Import guards (e.g. the Empty repo check) run during
decant and fail hard before any CR is produced, so invalid resources never enter
the pipeline to crash downstream (e.g. at gh_provisioner). The split keeps all
I/O in gather and makes decant pure and testable.
