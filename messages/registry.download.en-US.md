# summary

Download a LWC component from a remote registry (with interactive menu).

# description

This command lets you:

- Browse available LWC components
- Choose a version
- Pick a local destination folder
  The selected version is downloaded and extracted automatically.

# examples

$ sf registry download
$ sf registry download --interactive

# flags.name.summary

Component name to download

# flags.version.summary

Specific version of the component to download

# flags.target.summary

Local folder to extract the component to

# flags.server.summary

URL of the remote server hosting the registry

# errors.download.failed

Download failed: {0}

# prompts.selectComponent

Which component do you want to download?

# prompts.selectVersion

Which version of {0}?

# prompts.selectTargetFolder

Destination folder?

# prompts.customPath

Enter a path:
