.PHONY: test coverage-open

# Build the unit-test image, run the full suite, and fail if coverage is under 100%.
# HTML reports are left in ./coverage/ on the host.
test:
	mkdir -p coverage
	HOST_UID="$$(id -u)" HOST_GID="$$(id -g)" docker compose --profile test run --build --rm test

coverage-open:
	@test -f coverage/index.html || { echo "No report at coverage/index.html. Run make test first." >&2; exit 1; }
	@if command -v open >/dev/null 2>&1; then \
		open coverage/index.html; \
	elif command -v xdg-open >/dev/null 2>&1; then \
		xdg-open coverage/index.html; \
	else \
		echo "Open coverage/index.html in a browser." >&2; \
		exit 1; \
	fi
