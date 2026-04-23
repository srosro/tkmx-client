set shell := ["bash", "-cu"]

# Default: list available commands
default:
    @just --list

# Run the Node test suite
test:
    npm test
