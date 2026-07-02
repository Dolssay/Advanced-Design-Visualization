from matplotlib import pyplot as plt


def visualize_cruise_drag_buildup(ac):
    # Cruise drag buildup shown as a single offset horizontal bar chart.
    drag_components = [
        ('Wing profile', ac.wing_airfoil_cd_at_cruise_cl),
        ('Induced', ac.induced_drag_cdi),
        ('Fuselage', ac.fuselage_cd0),
        ('Horiz. tail', ac.horiz_tail_cd0),
        ('Vert. tail', ac.vert_tail_cd0),
        ('Landing gear', ac.landing_gear_cd0),
        ('Stopped rotor', ac.stopped_rotor_cd0),
    ]

    component_values = [0.0 if value is None else value for _, value in drag_components]
    total_value = 0.0 if ac.cruise_cd is None else ac.cruise_cd

    fig, ax = plt.subplots(figsize=(12, 5))

    group_a_color = '#4e79a7'
    total_color = '#7f7f7f'

    names = [name for name, _ in drag_components] + ['Total']
    values = component_values + [total_value]

    lefts = []
    running_left = 0.0
    for value in component_values:
        lefts.append(running_left)
        running_left += value

    lefts.append(0.0)

    colors = [group_a_color] * len(component_values) + [total_color]

    max_end = max(left + value for left, value in zip(lefts, values))
    label_offset = max(max_end * 0.03, 0.002)

    bars = ax.barh(names, values, left=lefts, color=colors, edgecolor='white')
    ax.set_xlabel('Coefficient of Drag')
    ax.set_title('Archer Midnight Cruise Drag Buildup')
    ax.set_xlim(0, max_end + label_offset * 6)
    ax.invert_yaxis()

    for bar, value in zip(bars, values):
        ax.text(
            bar.get_x() + bar.get_width() + label_offset,
            bar.get_y() + bar.get_height() / 2,
            f'{value:.4f}',
            va='center',
            fontsize=8,
        )

    return fig, ax
