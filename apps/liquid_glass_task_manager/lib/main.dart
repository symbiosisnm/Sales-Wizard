import 'package:flutter/material.dart';
import 'package:liquid_glass_renderer/liquid_glass_renderer.dart';

void main() {
  runApp(const LiquidGlassApp());
}

class LiquidGlassApp extends StatelessWidget {
  const LiquidGlassApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Liquid Glass Task Manager',
      theme: ThemeData.dark().copyWith(
        primaryColor: Colors.blueAccent,
        scaffoldBackgroundColor: Colors.black,
      ),
      home: const HomeScreen(),
      debugShowCheckedModeBanner: false,
    );
  }
}

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  bool _isDarkMode = true;
  final List<String> _tasks = ['Buy groceries', 'Finish report', 'Call friend'];

  void _addTask(String task) {
    setState(() {
      _tasks.add(task);
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Stack(
        children: [
          // Background with gradient for refraction effect
          Positioned.fill(
            child: Container(
              decoration: const BoxDecoration(
                gradient: LinearGradient(
                  colors: [Colors.blueGrey, Colors.black],
                  begin: Alignment.topCenter,
                  end: Alignment.bottomCenter,
                ),
              ),
            ),
          ),
          // Main content with liquid glass overlay
          SafeArea(
            child: Column(
              children: [
                // Glassy App Bar
                LiquidGlass(
                  settings: LiquidGlassSettings(
                    glassColor: Colors.white.withAlpha(50),
                    thickness: 0.5,
                    blur: 10.0,
                    lightAngle: 45.0,
                    lightIntensity: 0.8,
                    ambientStrength: 0.3,
                    chromaticAberration: 0.02, // From original shader
                    refractiveIndex: 1.5,
                  ),
                  shape: LiquidRoundedRectangle(borderRadius: const Radius.circular(0)),
                  child: AppBar(
                    title: const Text('Task Manager'),
                    backgroundColor: Colors.transparent,
                    elevation: 0,
                    actions: [
                      IconButton(
                        icon: Icon(_isDarkMode ? Icons.light_mode : Icons.dark_mode),
                        onPressed: () => setState(() => _isDarkMode = !_isDarkMode),
                      ),
                    ],
                  ),
                ),
                Expanded(
                  child: ListView.builder(
                    padding: const EdgeInsets.all(16),
                    itemCount: _tasks.length,
                    itemBuilder: (context, index) {
                      return AnimatedLiquidCard(
                        task: _tasks[index],
                        onTap: () => Navigator.push(
                          context,
                          MaterialPageRoute(
                            builder: (_) => DetailScreen(task: _tasks[index]),
                          ),
                        ),
                      );
                    },
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
      floatingActionButton: LiquidGlassButton(
        onPressed: () async {
          final newTask = await showDialog<String>(
            context: context,
            builder: (context) => const AddTaskDialog(),
          );
          if (newTask != null && newTask.isNotEmpty) {
            _addTask(newTask);
          }
        },
        child: const Icon(Icons.add),
      ),
    );
  }
}

// Custom Liquid Glass Card with Animation
class AnimatedLiquidCard extends StatefulWidget {
  final String task;
  final VoidCallback onTap;

  const AnimatedLiquidCard({super.key, required this.task, required this.onTap});

  @override
  State<AnimatedLiquidCard> createState() => _AnimatedLiquidCardState();
}

class _AnimatedLiquidCardState extends State<AnimatedLiquidCard>
    with SingleTickerProviderStateMixin {
  late AnimationController _controller;
  late Animation<double> _animation;

  @override
  void initState() {
    super.initState();
    _controller =
        AnimationController(vsync: this, duration: const Duration(milliseconds: 300));
    _animation = Tween<double>(begin: 0.0, end: 1.0).animate(_controller);
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: () {
        _controller.forward().then((_) => _controller.reverse());
        widget.onTap();
      },
      child: LiquidGlass(
        settings: LiquidGlassSettings(
          thickness: _animation.value * 0.2 + 0.3, // Animate thickness for liquid feel
          blur: 5.0,
          glassColor: Colors.blue.withAlpha(80),
          lightIntensity: 0.7,
          refractiveIndex: 1.33, // Water-like refraction
        ),
        shape: LiquidRoundedSuperellipse(borderRadius: const Radius.circular(20)),
        child: Card(
          color: Colors.transparent,
          margin: const EdgeInsets.symmetric(vertical: 8),
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Text(
              widget.task,
              style: const TextStyle(color: Colors.white),
            ),
          ),
        ),
      ),
    );
  }
}

// Liquid Glass Button
class LiquidGlassButton extends StatelessWidget {
  final VoidCallback onPressed;
  final Widget child;

  const LiquidGlassButton({super.key, required this.onPressed, required this.child});

  @override
  Widget build(BuildContext context) {
    return LiquidGlass(
      settings: const LiquidGlassSettings(
        thickness: 0.4,
        blur: 8.0,
        glassColor: Colors.white10,
        chromaticAberration: 0.01,
      ),
      shape: LiquidOval(),
      child: FloatingActionButton(
        onPressed: onPressed,
        backgroundColor: Colors.transparent,
        child: child,
      ),
    );
  }
}

// Detail Screen with Glass Panel
class DetailScreen extends StatelessWidget {
  final String task;

  const DetailScreen({super.key, required this.task});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Task Details')),
      body: Stack(
        children: [
          Positioned.fill(child: Container(color: Colors.grey[900])),
          Center(
            child: LiquidGlass(
              settings: const LiquidGlassSettings(
                thickness: 0.6,
                blur: 15.0,
                lightAngle: 30.0,
                ambientStrength: 0.4,
              ),
              shape: LiquidRoundedRectangle(borderRadius: const Radius.circular(30)),
              child: Container(
                padding: const EdgeInsets.all(32),
                child: Text(
                  'Details for: $task',
                  style: const TextStyle(fontSize: 24, color: Colors.white),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

// Add Task Dialog with Glass Effect
class AddTaskDialog extends StatelessWidget {
  const AddTaskDialog({super.key});

  @override
  Widget build(BuildContext context) {
    final controller = TextEditingController();
    return AlertDialog(
      backgroundColor: Colors.transparent,
      content: LiquidGlass(
        settings: const LiquidGlassSettings(blur: 10.0, thickness: 0.5),
        shape: LiquidRoundedSuperellipse(borderRadius: const Radius.circular(20)),
        child: TextField(
          controller: controller,
          decoration: const InputDecoration(
            hintText: 'New Task',
            hintStyle: TextStyle(color: Colors.white70),
          ),
          style: const TextStyle(color: Colors.white),
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context, controller.text),
          child: const Text('Add'),
        ),
      ],
    );
  }
}
