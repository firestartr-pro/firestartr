
# Installation

# requirements

- OpenTofu 1.10
- lerna@8.1.9

To install it, run the next commands:

```shell
wget https://github.com/opentofu/opentofu/releases/download/v1.10.10/tofu_1.10.10_linux_amd64.zip; \
unzip tofu_1.10.10_linux_amd64.zip;  \
mv tofu /usr/local/bin/;  \
chmod a+x /usr/local/bin/tofu;  \
rm -f tofu_1.10.10_linux_amd64.zip;  \
tofu --version;  \
npm install -g lerna@8.1.9;
```


# cli

## login

```shell
npm login --scope=@firestartr
npm notice Log in on https://registry.npmjs.org/
Username: <your_username>
Password: <pat>
Logged in to scope @firestartr on https://registry.npmjs.org/.
```

```shell
npm install @firestartr/cli
```
