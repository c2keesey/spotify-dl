.PHONY: tests clean sync

default: tests

clean:
	find . | grep -E "\(__pycache__|\.pyc|\.pyo$\)" | xargs rm -rf
	rm -f tests/*mp*
	rm -f tests/downloaded_songs.txt

tests: clean
	pip install -e .
	pip install pytest pytest-cov
	pytest --cov=spotify_dl tests/

sync:
	uv run spotify_dl --sync --config sync_config.json
