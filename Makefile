.PHONY: help pr-comments

# Default target
help:
	@echo "Available targets:"
	@echo "  make pr-comments [PR=<number>] - Display all comments from PR for current branch (or specify PR number)"
	@echo "  make help                      - Display this help message"

# Display all comments from PR for current branch (or specify PR number with PR=<number>)
pr-comments:
	@echo "Fetching PR comments..."
	@set -e; \
	if ! command -v gh >/dev/null 2>&1; then \
		echo "Error: 'gh' (GitHub CLI) is not installed. Please install it to use this command."; \
		exit 1; \
	fi; \
	if [ -n "$(PR)" ]; then \
		PR_NUMBER=$(PR); \
		echo "Using specified PR #$$PR_NUMBER"; \
	else \
		BRANCH=$$(git rev-parse --abbrev-ref HEAD); \
		if [ "$$BRANCH" = "HEAD" ] || [ "$$BRANCH" = "main" ] || [ "$$BRANCH" = "master" ]; then \
			echo "Error: Not on a feature branch (currently on $$BRANCH)"; \
			exit 1; \
		fi; \
		echo "Current branch: $$BRANCH"; \
		echo ""; \
		PR_NUMBER=$$(gh pr list --head "$$BRANCH" --json number --jq '.[0].number'); \
		if [ -z "$$PR_NUMBER" ]; then \
			echo "Error: No PR found for branch $$BRANCH"; \
			exit 1; \
		fi; \
	fi; \
	REPO=$$(gh repo view --json nameWithOwner --jq '.nameWithOwner'); \
	CURRENT_COMMIT=$$(git rev-parse HEAD); \
	echo "PR #$$PR_NUMBER"; \
	echo ""; \
	echo "================================================================================"; \
	echo "REGULAR PR COMMENTS (unaddressed only)"; \
	echo "================================================================================"; \
	echo ""; \
	TEMP_PR_COMMENTS=$$(mktemp); \
	gh pr view $$PR_NUMBER --json comments --jq '.comments[]? // empty | select(.isMinimized == false)' > "$$TEMP_PR_COMMENTS"; \
	PR_COMMENT_COUNT=$$(jq -s 'length' "$$TEMP_PR_COMMENTS"); \
	FOUND_UNADDRESSED_PR=false; \
	for i in $$(seq 0 $$((PR_COMMENT_COUNT - 1))); do \
		COMMENT_DATE=$$(jq -r -s ".[$${i}].createdAt" "$$TEMP_PR_COMMENTS"); \
		COMMITS_SINCE=$$(git log --since="$$COMMENT_DATE" --oneline); \
		if echo "$$COMMITS_SINCE" | grep -qi "addressed"; then \
			continue; \
		fi; \
		FOUND_UNADDRESSED_PR=true; \
		jq -r -s ".[$${i}] | \"Author: \(.author.login)\nDate: \(.createdAt)\nURL: \(.url)\n\n\(.body)\n\n\" + (\"─\" * 80) + \"\\n\"" "$$TEMP_PR_COMMENTS"; \
	done; \
	if [ "$$FOUND_UNADDRESSED_PR" = "false" ]; then \
		echo "All PR comments have been addressed! 🎉"; \
	fi; \
	rm -f "$$TEMP_PR_COMMENTS"; \
	echo ""; \
	echo "================================================================================"; \
	echo "REVIEW SUMMARIES (unaddressed only)"; \
	echo "================================================================================"; \
	echo ""; \
	TEMP_REVIEWS=$$(mktemp); \
	gh pr view $$PR_NUMBER --json reviews --jq '.reviews[]? // empty | select(.body != "" and (.isMinimized == false or .isMinimized == null))' > "$$TEMP_REVIEWS"; \
	REVIEW_COUNT=$$(jq -s 'length' "$$TEMP_REVIEWS"); \
	FOUND_UNADDRESSED_REVIEW=false; \
	for i in $$(seq 0 $$((REVIEW_COUNT - 1))); do \
		REVIEW_DATE=$$(jq -r -s ".[$${i}].submittedAt" "$$TEMP_REVIEWS"); \
		COMMITS_SINCE=$$(git log --since="$$REVIEW_DATE" --oneline); \
		if echo "$$COMMITS_SINCE" | grep -qi "addressed"; then \
			continue; \
		fi; \
		FOUND_UNADDRESSED_REVIEW=true; \
		jq -r -s ".[$${i}] | \"Reviewer: \(.author.login)\nState: \(.state)\nDate: \(.submittedAt)\n\n\(.body)\n\n\" + (\"─\" * 80) + \"\\n\"" "$$TEMP_REVIEWS"; \
	done; \
	if [ "$$FOUND_UNADDRESSED_REVIEW" = "false" ]; then \
		echo "All review summaries have been addressed! 🎉"; \
	fi; \
	rm -f "$$TEMP_REVIEWS"; \
	echo ""; \
	echo "================================================================================"; \
	echo "REVIEW COMMENTS (Line-level code comments - unaddressed only)"; \
	echo "================================================================================"; \
	echo ""; \
	TEMP_COMMENTS=$$(mktemp); \
	gh api --paginate repos/$$REPO/pulls/$$PR_NUMBER/comments > "$$TEMP_COMMENTS"; \
	COMMENT_COUNT=$$(jq 'length' "$$TEMP_COMMENTS"); \
	FOUND_UNADDRESSED=false; \
	for i in $$(seq 0 $$((COMMENT_COUNT - 1))); do \
		COMMENT_DATE=$$(jq -r ".[$${i}].created_at" "$$TEMP_COMMENTS"); \
		COMMITS_SINCE=$$(git log --since="$$COMMENT_DATE" --oneline); \
		if echo "$$COMMITS_SINCE" | grep -qi "addressed"; then \
			continue; \
		fi; \
		FOUND_UNADDRESSED=true; \
		jq -r ".[$${i}] | \"File: \(.path):\(.line // \"N/A\")\nAuthor: \(.user.login)\nDate: \(.created_at)\nURL: \(.html_url)\n\nContext (last 3 lines of diff):\n\(.diff_hunk | split(\"\\n\") | .[-3:] | join(\"\\n\"))\n\n\(.body)\n\n\" + (\"─\" * 80) + \"\\n\"" "$$TEMP_COMMENTS"; \
	done; \
	if [ "$$FOUND_UNADDRESSED" = "false" ]; then \
		echo "All review comments have been addressed! 🎉"; \
	fi; \
	rm -f "$$TEMP_COMMENTS"
