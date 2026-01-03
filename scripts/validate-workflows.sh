#!/bin/bash

# GitHub Actions Workflow Validation Script
# Validates workflow files before pushing to GitHub

set -e

echo "🔍 Validating GitHub Actions workflows..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if actionlint is installed
if ! command -v actionlint &> /dev/null; then
    echo -e "${YELLOW}⚠️  actionlint not found. Installing...${NC}"

    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS
        if command -v brew &> /dev/null; then
            brew install actionlint
        else
            echo -e "${RED}❌ Homebrew not found. Please install actionlint manually:${NC}"
            echo "   brew install actionlint"
            echo "   OR"
            echo "   go install github.com/rhysd/actionlint/cmd/actionlint@latest"
            exit 1
        fi
    elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
        # Linux
        if command -v go &> /dev/null; then
            go install github.com/rhysd/actionlint/cmd/actionlint@latest
        else
            echo -e "${RED}❌ Go not found. Please install actionlint manually:${NC}"
            echo "   https://github.com/rhysd/actionlint"
            exit 1
        fi
    else
        echo -e "${RED}❌ Unsupported OS. Please install actionlint manually:${NC}"
        echo "   https://github.com/rhysd/actionlint"
        exit 1
    fi
fi

# Run actionlint on all workflow files
echo ""
echo "Running actionlint on workflow files..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

WORKFLOWS_DIR=".github/workflows"
FAILED=0

if [ -d "$WORKFLOWS_DIR" ]; then
    for workflow in "$WORKFLOWS_DIR"/*.yml "$WORKFLOWS_DIR"/*.yaml; do
        if [ -f "$workflow" ]; then
            echo ""
            echo "📄 Checking: $workflow"

            if actionlint "$workflow"; then
                echo -e "${GREEN}✅ PASSED: $workflow${NC}"
            else
                echo -e "${RED}❌ FAILED: $workflow${NC}"
                FAILED=1
            fi
        fi
    done
else
    echo -e "${RED}❌ Workflows directory not found: $WORKFLOWS_DIR${NC}"
    exit 1
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ $FAILED -eq 1 ]; then
    echo -e "${RED}❌ Some workflows have errors. Please fix them before pushing.${NC}"
    exit 1
else
    echo -e "${GREEN}✅ All workflows validated successfully!${NC}"
    echo ""
    echo "Safe to push to GitHub! 🚀"
    exit 0
fi
