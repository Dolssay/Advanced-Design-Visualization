from matplotlib import pyplot as plt

def visualize_mass_breakdown(structural, propulsion, subsystems, ac):
    # Pie chart of major mass groups
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
    ax1.set_title('Archer Midnight Mass Groups')

    # Bar chart of individual components
    all_components = {}
    all_components.update(structural)
    all_components.update(propulsion)
    all_components.update(subsystems)
    all_components['Battery'] = ac.battery_mass_kg
    all_components['Payload'] = ac.payload_kg

    names = list(all_components.keys())
    masses = list(all_components.values())

    bars = ax2.barh(names, masses, color='steelblue', edgecolor='white')
    ax2.set_xlabel('Mass (kg)')
    ax2.set_title('Archer Midnight Component Masses')
    for bar, mass in zip(bars, masses):
        ax2.text(bar.get_width() + 5, bar.get_y() + bar.get_height()/2,
                f'{mass:.1f}', va='center', fontsize=8)
    
    return fig, (ax1, ax2)