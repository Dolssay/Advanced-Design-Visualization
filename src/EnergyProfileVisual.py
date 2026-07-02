from matplotlib import pyplot as plt


def visualize_energy_profile(ac):
    # Energy profile components shown as an offset horizontal bar chart.
    primary_segments = [
        ('Taxi-out', ac.depart_taxi_energy_kw_hr),
        ('Hover Climb', ac.hover_climb_energy_kw_hr),
        ('Trans. Climb', ac.trans_climb_energy_kw_hr),
        ('Depart proc.', ac.depart_proc_energy_kw_hr),
        ('Accel Climb', ac.accel_climb_energy_kw_hr),
        ('Cruise', ac.cruise_energy_kw_hr),
        ('Decel desc.', ac.decel_descend_energy_kw_hr),
        ('Arrive proc.', ac.arrive_proc_energy_kw_hr),
        ('Trans. desc.', ac.trans_descend_energy_kw_hr),
        ('Hover desc.', ac.hover_descend_energy_kw_hr),
        ('Taxi-in', ac.arrive_taxi_energy_kw_hr),
    ]

    reserve_segments = [
        ac.reserve_hover_climb_energy_kw_hr,
        ac.reserve_trans_climb_energy_kw_hr,
        ac.reserve_accel_climb_energy_kw_hr,
        ac.reserve_cruise_energy_kw_hr,
        ac.reserve_decel_descend_energy_kw_hr,
        ac.reserve_trans_descend_energy_kw_hr,
        ac.reserve_hover_descend_energy_kw_hr,
    ]

    primary_values = [0.0 if energy is None else energy for _, energy in primary_segments]
    reserve_value = sum(0.0 if energy is None else energy for energy in reserve_segments)
    total_value = sum(primary_values) + reserve_value

    fig, ax = plt.subplots(figsize=(14, 6))

    group_a_color = "#2e924c"
    group_b_color = "#c9b77b"
    total_color = "#8b4242"

    names = [name for name, _ in primary_segments] + ['Reserve', 'Total']
    masses = primary_values + [reserve_value, total_value]

    lefts = []
    running_left = 0.0
    for energy in primary_values:
        lefts.append(running_left)
        running_left += energy

    lefts.append(running_left)
    lefts.append(0.0)

    colors = [group_a_color] * len(primary_values) + [group_b_color, total_color]

    max_end = max(left + mass for left, mass in zip(lefts, masses))
    label_offset = max(max_end * 0.03, 5)

    bars = ax.barh(names, masses, left=lefts, color=colors, edgecolor='white')
    ax.set_xlabel('Energy (kW-hr)')
    ax.set_title('Archer Midnight Energy Profile')
    ax.set_xlim(0, max_end + label_offset * 6)
    ax.invert_yaxis()

    for bar, mass in zip(bars, masses):
        ax.text(
            bar.get_x() + bar.get_width() + label_offset,
            bar.get_y() + bar.get_height() / 2,
            f'{mass:.1f}',
            va='center',
            fontsize=8,
        )

    return fig, ax
