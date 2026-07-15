from matplotlib import pyplot as plt


def visualize_power_profile(ac):
    # Power profile shown as a simple horizontal bar chart with no offsets.
    power_segments = [
        ('Taxi-out', ac.depart_taxi_avg_electric_power_kw),
        ('Hover Climb', ac.hover_climb_avg_electric_power_kw),
        ('Trans. Climb', ac.trans_climb_avg_electric_power_kw),
        ('Depart proc.', ac.depart_proc_avg_electric_power_kw),
        ('Accel Climb', ac.accel_climb_avg_electric_power_kw),
        ('Cruise', ac.cruise_avg_electric_power_kw),
        ('Decel desc.', ac.decel_descend_avg_electric_power_kw),
        ('Arrive proc.', ac.arrive_proc_avg_electric_power_kw),
        ('Trans. desc.', ac.trans_descend_avg_electric_power_kw),
        ('Hover desc.', ac.hover_descend_avg_electric_power_kw),
        ('Taxi-in', ac.arrive_taxi_avg_electric_power_kw),
    ]

    values = [0.0 if power is None else power for _, power in power_segments]
    names = [name for name, _ in power_segments]

    fig, ax = plt.subplots(figsize=(14, 6))

    group_color = '#4e79a7'
    colors = [group_color] * len(values)
    max_value = max(values) if values else 0.0
    label_offset = max(max_value * 0.03, 5)

    bars = ax.barh(names, values, color=colors, edgecolor='white')
    ax.set_xlabel('Electric Power (kW)')
    ax.set_title('Archer Midnight Power Profile')
    ax.set_xlim(0, max_value + label_offset * 6)
    ax.invert_yaxis()

    for bar, value in zip(bars, values):
        ax.text(
            bar.get_x() + bar.get_width() + label_offset,
            bar.get_y() + bar.get_height() / 2,
            f'{value:.1f}',
            va='center',
            fontsize=8,
        )

    return fig, ax
