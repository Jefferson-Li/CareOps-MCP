.PHONY: test

# Build the unit-test image, run the full suite, and fail if coverage is under 100%.
test:
	docker compose --profile test run --build --rm test
