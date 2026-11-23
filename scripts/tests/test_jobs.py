"""scripts/offline_maps/jobs.py: the queue of downloads left."""

from offline_maps.jobs import Job, read_queue, save_queue


def test_the_queue_resumes_after_the_folder_moved(tmp_path):
    """The bug: the queue saved full paths, so after data/offline-maps/ moved to
    data/map/offline-maps/, Resume downloaded into the old place again."""
    old = tmp_path / "data" / "offline-maps"
    old.mkdir(parents=True)
    job = Job(
        "IGN 20 cm, 2 départements, z17",
        ["bdortho", "--dept", "40", "24", "--maps-dir", str(old)],
    )
    sentinel = Job(
        "Sentinel-2, Luxembourg",
        [
            "regional",
            "--outline",
            "/elsewhere/lux.geojson",
            "--out",
            str(old / "lux.sat-regional.pmtiles"),
        ],
    )
    save_queue(old, [job, sentinel])
    assert str(old) not in (old / "queue.json").read_text()

    new = tmp_path / "data" / "map" / "offline-maps"
    new.parent.mkdir(parents=True)
    old.rename(new)
    resumed = read_queue(new)
    assert resumed[0].argv == ["bdortho", "--dept", "40", "24", "--maps-dir", str(new)]
    assert resumed[1].argv[-1] == str(new / "lux.sat-regional.pmtiles")
    assert (
        resumed[1].argv[2] == "/elsewhere/lux.geojson"
    )  # outside the folder: as it was


def test_an_empty_queue_leaves_no_file(tmp_path):
    save_queue(tmp_path, [Job("x", ["overview"])])
    save_queue(tmp_path, [])
    assert not (tmp_path / "queue.json").exists()
    assert read_queue(tmp_path) == []
