from app.services.ai.horalix_ai.utils.overlay_gating import area_ratio_valid, area_change_valid


def test_area_ratio_valid_bounds():
    assert area_ratio_valid(0.05)
    assert area_ratio_valid(0.01)
    assert area_ratio_valid(0.7)
    assert not area_ratio_valid(0.0)
    assert not area_ratio_valid(0.9)


def test_area_change_valid_threshold():
    assert area_change_valid(None, 0.2)
    assert area_change_valid(0.0, 0.2)
    assert area_change_valid(0.2, 0.25)
    assert not area_change_valid(0.2, 0.35)
