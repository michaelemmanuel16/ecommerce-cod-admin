#!/bin/bash

# Pre-Push Validation Script
# Runs all checks before pushing to GitHub for CI/CD
# This simulates the CI/CD pipeline locally

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}╔═══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║          Pre-Push Validation - CI/CD Simulation              ║${NC}"
echo -e "${BLUE}╚═══════════════════════════════════════════════════════════════╝${NC}"
echo ""

FAILED=0

# Function to run a check
run_check() {
    local name=$1
    local command=$2

    echo ""
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${YELLOW}🔍 Running: $name${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

    if (eval "$command"); then
        echo -e "${GREEN}✅ PASSED: $name${NC}"
        return 0
    else
        echo -e "${RED}❌ FAILED: $name${NC}"
        FAILED=1
        return 1
    fi
}

# Fast checks only (about a minute): lint, type check, backend unit tests, workflow lint.
# Not run here, on purpose: the backend integration suite (serial, ~15 min; CI runs it sharded),
# frontend tests/builds (CI runs them). `npm test` is not used: its script already sets --maxWorkers,
# so extra Jest flags such as --runInBand are refused. For integration tests locally:
#   cd backend && npm run test:integration:parallel

# 1. Backend Lint
run_check "Backend ESLint" "cd backend && npm run lint"

# 2. Frontend Lint
run_check "Frontend ESLint" "cd frontend && npm run lint"

# 3. Backend type check
run_check "Backend tsc" "cd backend && npx tsc --noEmit"

# 4. Frontend type check
run_check "Frontend tsc" "cd frontend && npx tsc --noEmit"

# 5. Backend unit tests
run_check "Backend unit tests" "cd backend && npm run test:unit -- --passWithNoTests --forceExit"

# 6. Validate GitHub Workflows
if [ -f "./scripts/validate-workflows.sh" ]; then
    run_check "GitHub Workflows Validation" "./scripts/validate-workflows.sh"
else
    echo -e "${YELLOW}⚠️  Skipping workflow validation (script not found)${NC}"
fi

# Summary
echo ""
echo -e "${BLUE}╔═══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║                     Validation Summary                        ║${NC}"
echo -e "${BLUE}╚═══════════════════════════════════════════════════════════════╝${NC}"
echo ""

if [ $FAILED -eq 1 ]; then
    echo -e "${RED}❌ Some checks failed. Please fix the errors before pushing to GitHub.${NC}"
    echo ""
    exit 1
else
    echo -e "${GREEN}✅ All checks passed successfully!${NC}"
    echo ""
    echo -e "${GREEN}🚀 Safe to push to GitHub for production!${NC}"
    echo ""
    exit 0
fi
