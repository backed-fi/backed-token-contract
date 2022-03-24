# Backed Finance token contract 
![test workflow status](https://github.com/backed-fi/backed-token-contract/actions/workflows/test.yml/badge.svg?branch=main)


This repo contains the token contracts of Backed Finance AG. Meant to be used mostly for the tokenized stocks products by Backed Assets GmbH.

## Functionality

The token is an ERC20 token. Inheriting the OpenZeppelin ERC20.sol. 
It adds on top of it a permit and delegateTransfer functions, to allow approving and transferring via ERC712 signatures, mostly based on code by OpenZeppelin.
The contract also has an owner, that can set the minter and burner roles. As well as turn on and off the ability to use the ERC712 functionality for specific or all users.

## Installing

```shell
    npm install
```

## Available script
*Compile*
```shell
    npm run compile
```
*test*
```shell
    npm run test
```

*lint*
```shell
    npm run lint
```