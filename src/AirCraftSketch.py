from matplotlib import pyplot as plt
from matplotlib.patches import Circle, Rectangle, FancyBboxPatch


def visualize_aircraft_layout(ac):
    """
    Draw a simple top-view and front-view sketch of the eVTOL.

    Expected aircraft attributes
    ----------------------------
    ac.wingspan_m
    ac.rotor_diameter_m
    ac.lift_rotor_count
    ac.tilt_rotor_count
    ac.wing_loading_kg_m2
    ac.disk_loading_kg_m2
    ac.thrust_to_weight
    ac.cruise_speed_mps
    """

    def _get_attr(*path):
        value = ac
        try:
            for part in path:
                value = getattr(value, part)
            return value
        except AttributeError:
            return None

    def _rotor_positions(count, span_width):
        count = int(count or 0)
        if count <= 0:
            return []
        if count == 1:
            return [0.0]
        return [(-span_width / 2.0) + (span_width * i / (count - 1)) for i in range(count)]

    fig = plt.figure(figsize=(12,10))

    ###############################################################
    # Top View
    ###############################################################

    ax = plt.axes([0.04,0.22,0.92,0.72])

    span = ac.wingspan_m
    rotor_d = _get_attr('rotor_diameter_m')
    if rotor_d is None:
        rotor_d = _get_attr('propulsion', 'rotor_diameter_m')
    if rotor_d is None:
        raise AttributeError('Aircraft object does not expose a rotor diameter')
    r = rotor_d/2

    # Wing
    wing_y = 0
    wing_thickness = 0.7

    ax.add_patch(
        Rectangle(
            (-span/2, wing_y-wing_thickness/2),
            span,
            wing_thickness,
            color='lightgray'
        )
    )

    # Fuselage
    fus_length = ac.fuselage_l_m
    fus_width = ac.fuselage_w_m

    ax.add_patch(
        FancyBboxPatch(
            (-fus_width/2,-fus_length/2),
            fus_width,
            fus_length,
            boxstyle="round,pad=0.02,rounding_size=0.6",
            facecolor='silver',
            edgecolor='none'
        )
    )

    ax.plot([0,0],[-fus_length/2,fus_length/2],
            '--',color='gray')

    ###############################################################
    # Rotor locations
    ###############################################################

    lift_rotors = _get_attr('lift_rotor_count')
    if lift_rotors is None:
        lift_rotors = _get_attr('propulsion', 'lift_rotor_count')

    tilt_rotors = _get_attr('tilt_rotor_count')
    if tilt_rotors is None:
        tilt_rotors = _get_attr('propulsion', 'tilt_rotor_count')

    lift_xs = _rotor_positions(lift_rotors, span)
    tilt_xs = _rotor_positions(tilt_rotors, span)

    upper_y = rotor_d*0.85
    lower_y = -rotor_d*0.85

    for x in lift_xs:

        ax.plot([x,x],[wing_y,upper_y],
                color='silver',lw=4)

        ax.add_patch(
            Circle((x,upper_y),r,
                   fill=False,lw=2)
        )

    for x in tilt_xs:

        ax.plot([x,x],[lower_y,wing_y],
                color='silver',lw=4)

        ax.add_patch(
            Circle((x,lower_y),r,
                   fill=False,lw=2)
        )

    ###############################################################
    # Divider
    ###############################################################

    ax.plot(
        [-span/2-2, span/2+2],
        [-fus_length/2-1.3,-fus_length/2-1.3],
        '--',
        color='black'
    )

    ###############################################################
    # Front View
    ###############################################################

    front_y = -fus_length/2-4

    ax.plot(
        [-span/2, span/2],
        [front_y, front_y],
        color='silver',
        lw=5
    )

    ax.add_patch(
        Circle(
            (0,front_y-0.8),
            r,
            fill=False,
            lw=2
        )
    )

    ax.add_patch(
        Circle(
            (0,front_y-0.8),
            r*0.35,
            color='silver'
        )
    )

    ###############################################################
    # Aircraft Information
    ###############################################################

    wing_area_m2 = _get_attr('wing_area_m2')
    if wing_area_m2 is not None:
        wing_loading_kg_m2 = ac.max_takeoff_mass_kg / wing_area_m2
    else:
        wing_loading_kg_m2 = _get_attr('wing_loading_kg_m2')

    disk_loading_kg_m2 = _get_attr('disk_loading_kg_m2')
    if disk_loading_kg_m2 is None:
        disk_loading_kg_m2 = _get_attr('disk_loading_kg_p_m2')

    thrust_to_weight = _get_attr('thrust_to_weight')
    if thrust_to_weight is None:
        thrust_to_weight = _get_attr('propulsion', 'thrust_to_weight')

    tilt_rotors = _get_attr('tilt_rotor_count')
    if tilt_rotors is None:
        tilt_rotors = _get_attr('propulsion', 'tilt_rotor_count')

    def _format_value(value, fmt):
        return fmt.format(value) if value is not None else 'N/A'

    info = (
        f"b = {ac.wingspan_m:.2f} m\n"
        f"Wing loading: {_format_value(wing_loading_kg_m2, '{:.1f}')} kg/m²\n"
        f"Disk loading: {_format_value(disk_loading_kg_m2, '{:.1f}')} kg/m²\n"
        f"Thrust-to-weight (T/W): {_format_value(thrust_to_weight, '{:.2f}')}\n"
        f"Rotor diameter: {rotor_d:.2f} m\n"
        f"Lift rotors: {lift_rotors}\n"
        f"Tilt rotors: {tilt_rotors}"
    )

    ax.text(
        0,
        front_y-6.3,
        info,
        fontsize=12,
        ha='center',
        va='center',
        bbox=dict(facecolor='white',
                  edgecolor='gray')
    )

    ###############################################################

    ax.set_aspect('equal')

    ax.set_xlim(-span/2-2.0, span/2+2.0)
    ax.set_ylim(front_y-7.0, fus_length/2+4.0)

    ax.axis('off')

    fig.text(0.5, 0.935, "eVTOL Layout", ha='center', va='top', fontsize=22)

    return fig, ax