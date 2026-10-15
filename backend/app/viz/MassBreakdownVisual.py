from matplotlib import pyplot as plt

def visualize_mass_breakdown(structural, propulsion, subsystems, ac, name='Archer Midnight'):
    # Pie chart of major mass groups
    group_colors = {
        'Structural': '#4e79a7',
        'Propulsion': '#f28e2b',
        'Subsystems': '#76b7b2',
        'Battery': '#e15759',
        'Payload': '#59a14f',
    }
    groups = {
        'Structural': sum(structural.values()),
        'Propulsion': sum(propulsion.values()),
        'Subsystems': sum(subsystems.values()),
        'Battery': ac.battery_mass_kg,
        'Payload': ac.payload_kg,
    }

    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(14, 5))

    # Pie chart
    colors = ['#4e79a7', '#f28e2b', '#76b7b2', '#e15759', '#59a14f']
    wedges, texts, autotexts = ax1.pie(
        groups.values(), labels=groups.keys(), autopct='%1.1f%%',
        colors=colors, startangle=90
    )
    ax1.set_title(f'{name} Mass Groups')

    # Bar chart of individual components
    all_components = {}
    component_colors = {}

    all_components.update(structural)
    component_colors.update({name: group_colors['Structural'] for name in structural})

    all_components.update(propulsion)
    component_colors.update({name: group_colors['Propulsion'] for name in propulsion})

    all_components.update(subsystems)
    component_colors.update({name: group_colors['Subsystems'] for name in subsystems})

    all_components['Battery'] = ac.battery_mass_kg
    component_colors['Battery'] = group_colors['Battery']

    all_components['Payload'] = ac.payload_kg
    component_colors['Payload'] = group_colors['Payload']

    names = list(all_components.keys())
    masses = list(all_components.values())
    bar_colors = [component_colors[name] for name in names]
    max_mass = max(masses)
    label_offset = max(max_mass * 0.03, 5)

    bars = ax2.barh(names, masses, color=bar_colors, edgecolor='white')
    ax2.set_xlabel('Mass (kg)')
    ax2.set_title(f'{name} Component Masses')
    ax2.set_xlim(0, max_mass + label_offset * 6)
    for bar, mass in zip(bars, masses):
        ax2.text(bar.get_width() + label_offset, bar.get_y() + bar.get_height()/2,
                f'{mass:.1f}', va='center', fontsize=8)
    
    return fig, (ax1, ax2)