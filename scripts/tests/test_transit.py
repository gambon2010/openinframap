"""scripts/offline_maps/transit.py: an area's trams and metro drawn by LOOM, in three
steps (the backend's input, LOOM, the backend's packing)."""

from offline_maps import transit


def test_the_three_steps_in_order_then_the_work_folder_goes(tmp_path, monkeypatch):
    calls = []
    monkeypatch.setattr(
        transit.docker,
        "run_backend_module",
        lambda module, folder, area: calls.append(module),
    )

    def loom(service, args, mount, at):
        calls.append(service)
        assert mount == transit.work_of(tmp_path, "france")

    monkeypatch.setattr(transit.docker, "run_service", loom)
    transit.work_of(tmp_path, "france").mkdir()
    transit.make_transit(tmp_path, "france")
    assert calls == ["loom_input", "loom", "loom_tiles"]
    assert not transit.work_of(tmp_path, "france").exists()


def test_loom_draws_each_network_at_the_maps_zooms():
    script = transit.loom_script()
    assert "topo" in script and "| loom >" in script
    assert "-z 12,13,14,15,16,17,18" in script
    assert f"--line-width {transit.LOOM_LINE_WIDTH}" in script
    assert f"xargs -P {transit.PARALLEL}" in script
