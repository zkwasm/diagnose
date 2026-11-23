#include <gtk/gtk.h>
#include <json-glib/json-glib.h>
#include <string.h>

typedef struct {
    GtkWidget *window, *language, *status, *invitation, *choices, *start, *stop, *copy, *revoke;
    GtkTextView *activity;
    JsonParser *labels;
    GSubprocess *worker;
    GCancellable *reader;
    gchar *root;
    gchar *preference;
    gboolean ending, closing;
    guint stop_timer;
} Probe;

static const char *languages[] = { "en", "zh", "es" };

static const char *selected_language(Probe *probe) {
    int index = gtk_combo_box_get_active(GTK_COMBO_BOX(probe->language));
    return languages[index < 0 ? 0 : index];
}

static const char *label(Probe *probe, const char *key) {
    JsonObject *all = json_node_get_object(json_parser_get_root(probe->labels));
    JsonObject *locale = json_object_get_object_member(all, selected_language(probe));
    return json_object_get_string_member(locale, key);
}

static void update_controls(Probe *probe) {
    gtk_widget_set_sensitive(probe->start, probe->worker == NULL);
    gtk_widget_set_sensitive(probe->language, probe->worker == NULL);
    gtk_widget_set_sensitive(probe->stop, probe->worker != NULL && !probe->ending);
    gtk_widget_set_sensitive(probe->copy, *gtk_entry_get_text(GTK_ENTRY(probe->invitation)) != '\0');
}

static void update_labels(Probe *probe) {
    gtk_button_set_label(GTK_BUTTON(probe->start), label(probe, "start"));
    gtk_button_set_label(GTK_BUTTON(probe->stop), label(probe, "end"));
    gtk_button_set_label(GTK_BUTTON(probe->copy), label(probe, "copy"));
    gtk_button_set_label(GTK_BUTTON(probe->revoke), label(probe, "revoke"));
    gtk_entry_set_placeholder_text(GTK_ENTRY(probe->invitation), label(probe, "code"));
    if (!probe->worker) gtk_label_set_text(GTK_LABEL(probe->status), label(probe, "ready"));
    update_controls(probe);
}

static void append_activity(Probe *probe, const char *line) {
    GtkTextBuffer *buffer = gtk_text_view_get_buffer(probe->activity);
    GtkTextIter end;
    if (gtk_text_buffer_get_char_count(buffer) > 200000) gtk_text_buffer_set_text(buffer, "", -1);
    gtk_text_buffer_get_end_iter(buffer, &end);
    gtk_text_buffer_insert(buffer, &end, line, -1);
    gtk_text_buffer_insert(buffer, &end, "\n", 1);
    gtk_text_view_scroll_to_iter(probe->activity, &end, 0, FALSE, 0, 0);
}

static void clear_choices(Probe *probe) {
    GList *children = gtk_container_get_children(GTK_CONTAINER(probe->choices));
    for (GList *item = children; item; item = item->next) gtk_widget_destroy(GTK_WIDGET(item->data));
    g_list_free(children);
}

static void answer(Probe *probe, const char *choice) {
    if (!probe->worker || probe->ending) return;
    g_autofree gchar *line = g_strconcat(choice, "\n", NULL);
    GOutputStream *input = g_subprocess_get_stdin_pipe(probe->worker);
    g_output_stream_write_all(input, line, strlen(line), NULL, NULL, NULL);
}

static void choose(GtkButton *button, Probe *probe) {
    const char *value = g_object_get_data(G_OBJECT(button), "answer");
    answer(probe, value);
    clear_choices(probe);
}

static void add_choice(Probe *probe, const char *value, const char *key) {
    GtkWidget *button = gtk_button_new_with_label(label(probe, key));
    g_object_set_data(G_OBJECT(button), "answer", (gpointer) value);
    g_signal_connect(button, "clicked", G_CALLBACK(choose), probe);
    gtk_box_pack_start(GTK_BOX(probe->choices), button, FALSE, FALSE, 0);
    gtk_widget_show(button);
}

static void receive(Probe *probe, const char *line) {
    if (probe->ending) return;
    if (*line != 30) { append_activity(probe, line); return; }
    g_autoptr(JsonParser) parser = json_parser_new();
    if (!json_parser_load_from_data(parser, line + 1, -1, NULL)) return;
    JsonObject *message = json_node_get_object(json_parser_get_root(parser));
    if (!message) return;
    const char *event = json_object_get_string_member(message, "event");
    const char *status = json_object_get_string_member(message, "text");
    if (!event || !status) return;
    if (!strcmp(event, "serial-ready") || !strcmp(event, "awaiting-serial-device")) {
        append_activity(probe, status);
        return;
    }
    gtk_label_set_text(GTK_LABEL(probe->status), status);
    const char *code = json_object_has_member(message, "code") ? json_object_get_string_member(message, "code") : "";
    gtk_entry_set_text(GTK_ENTRY(probe->invitation), code ? code : "");
    clear_choices(probe);
    if (!strcmp(event, "connected") || !strcmp(event, "ended"))
        gtk_widget_set_sensitive(probe->revoke, !strcmp(event, "connected"));
    if (!strcmp(event, "startup")) {
        add_choice(probe, "", "everything");
        add_choice(probe, "r", "review");
        add_choice(probe, "a", "confirm");
    } else if (!strcmp(event, "pair-auto")) {
        add_choice(probe, "y", "allow");
        add_choice(probe, "r", "allowReview");
        add_choice(probe, "n", "reject");
    } else if (!strcmp(event, "pair-review")) {
        add_choice(probe, "y", "allowReview");
        add_choice(probe, "a", "allowAuto");
        add_choice(probe, "n", "reject");
    } else if (!strcmp(event, "review")) {
        add_choice(probe, "y", "once");
        add_choice(probe, "a", "session");
        add_choice(probe, "d", "details");
        add_choice(probe, "n", "reject");
    }
    update_controls(probe);
}

static void read_line(GObject *object, GAsyncResult *result, gpointer user_data) {
    Probe *probe = user_data;
    GDataInputStream *stream = G_DATA_INPUT_STREAM(object);
    GCancellable *reader = g_object_get_data(object, "reader");
    g_autofree gchar *line = g_data_input_stream_read_line_finish_utf8(stream, result, NULL, NULL);
    if (!line || reader != probe->reader) return;
    receive(probe, line);
    g_data_input_stream_read_line_async(stream, G_PRIORITY_DEFAULT, reader, read_line, probe);
}

static void finished(GObject *object, GAsyncResult *result, gpointer user_data) {
    Probe *probe = user_data;
    GSubprocess *worker = G_SUBPROCESS(object);
    gboolean success = g_subprocess_wait_check_finish(worker, result, NULL);
    if (probe->stop_timer) { g_source_remove(probe->stop_timer); probe->stop_timer = 0; }
    g_cancellable_cancel(probe->reader);
    g_clear_object(&probe->reader);
    g_clear_object(&probe->worker);
    probe->ending = FALSE;
    if (probe->closing) {
        gtk_widget_destroy(probe->window);
        return;
    }
    clear_choices(probe);
    gtk_entry_set_text(GTK_ENTRY(probe->invitation), "");
    gtk_widget_set_sensitive(probe->revoke, FALSE);
    update_labels(probe);
    if (!success) gtk_label_set_text(GTK_LABEL(probe->status), label(probe, "failed"));
}

static void start(GtkButton *button, Probe *probe) {
    g_autofree gchar *node = g_build_filename(probe->root, "node", NULL);
    g_autofree gchar *cli = g_build_filename(probe->root, "dist", "cli.js", NULL);
    const char *args[] = { node, cli, "start", "--desktop-stdio", "--lang", selected_language(probe), NULL };
    g_autoptr(GError) error = NULL;
    g_autoptr(GSubprocessLauncher) launch = g_subprocess_launcher_new(G_SUBPROCESS_FLAGS_STDIN_PIPE | G_SUBPROCESS_FLAGS_STDOUT_PIPE | G_SUBPROCESS_FLAGS_STDERR_MERGE);
    g_subprocess_launcher_set_cwd(launch, probe->root);
    probe->worker = g_subprocess_launcher_spawnv(launch, args, &error);
    if (!probe->worker) {
        gtk_label_set_text(GTK_LABEL(probe->status), label(probe, "failed"));
        append_activity(probe, error->message);
        return;
    }
    probe->reader = g_cancellable_new();
    g_autoptr(GDataInputStream) stream = g_data_input_stream_new(g_subprocess_get_stdout_pipe(probe->worker));
    g_object_set_data_full(G_OBJECT(stream), "reader", g_object_ref(probe->reader), g_object_unref);
    g_data_input_stream_read_line_async(stream, G_PRIORITY_DEFAULT, probe->reader, read_line, probe);
    g_subprocess_wait_check_async(probe->worker, NULL, finished, probe);
    gtk_label_set_text(GTK_LABEL(probe->status), label(probe, "starting"));
    update_controls(probe);
}

static gboolean force_stop(gpointer user_data) {
    Probe *probe = user_data;
    probe->stop_timer = 0;
    if (probe->worker) g_subprocess_force_exit(probe->worker);
    return G_SOURCE_REMOVE;
}

static void end(Probe *probe) {
    if (!probe->worker || probe->ending) return;
    probe->ending = TRUE;
    g_output_stream_close(g_subprocess_get_stdin_pipe(probe->worker), NULL, NULL);
    probe->stop_timer = g_timeout_add(1800, force_stop, probe);
    clear_choices(probe);
    gtk_entry_set_text(GTK_ENTRY(probe->invitation), "");
    gtk_widget_set_sensitive(probe->revoke, FALSE);
    update_controls(probe);
}

static gboolean close_window(GtkWidget *window, GdkEvent *event, Probe *probe) {
    if (!probe->worker) return FALSE;
    probe->closing = TRUE;
    gtk_widget_set_sensitive(window, FALSE);
    end(probe);
    return TRUE;
}

static void end_click(GtkButton *button, Probe *probe) { end(probe); }
static void revoke(GtkButton *button, Probe *probe) { answer(probe, "permissions ask"); }
static void copy(GtkButton *button, Probe *probe) {
    gtk_clipboard_set_text(gtk_clipboard_get(GDK_SELECTION_CLIPBOARD), gtk_entry_get_text(GTK_ENTRY(probe->invitation)), -1);
}

static void change_language(GtkComboBox *box, Probe *probe) {
    g_autofree gchar *directory = g_path_get_dirname(probe->preference);
    if (g_mkdir_with_parents(directory, 0700) == 0) g_file_set_contents(probe->preference, selected_language(probe), -1, NULL);
    update_labels(probe);
}

static void activate(GtkApplication *app, Probe *probe) {
    if (probe->window) { gtk_window_present(GTK_WINDOW(probe->window)); return; }
    probe->window = gtk_application_window_new(app);
    gtk_window_set_title(GTK_WINDOW(probe->window), "Diagnose Probe");
    gtk_window_set_icon_name(GTK_WINDOW(probe->window), "diagnose-probe");
    gtk_window_set_default_size(GTK_WINDOW(probe->window), 760, 440);
    gtk_container_set_border_width(GTK_CONTAINER(probe->window), 18);
    GtkWidget *panel = gtk_box_new(GTK_ORIENTATION_VERTICAL, 14);
    GtkWidget *controls = gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 8);
    GtkWidget *code_row = gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 8);
    GtkWidget *scroll = gtk_scrolled_window_new(NULL, NULL);
    probe->choices = gtk_box_new(GTK_ORIENTATION_HORIZONTAL, 8);
    probe->language = gtk_combo_box_text_new();
    probe->start = gtk_button_new();
    probe->stop = gtk_button_new();
    probe->revoke = gtk_button_new();
    probe->copy = gtk_button_new();
    probe->status = gtk_label_new("");
    probe->invitation = gtk_entry_new();
    probe->activity = GTK_TEXT_VIEW(gtk_text_view_new());
    gtk_label_set_line_wrap(GTK_LABEL(probe->status), TRUE);
    gtk_label_set_xalign(GTK_LABEL(probe->status), 0);
    gtk_editable_set_editable(GTK_EDITABLE(probe->invitation), FALSE);
    gtk_text_view_set_editable(probe->activity, FALSE);
    gtk_text_view_set_wrap_mode(probe->activity, GTK_WRAP_WORD_CHAR);
    gtk_text_view_set_left_margin(probe->activity, 10);
    gtk_widget_set_sensitive(probe->revoke, FALSE);
    const char *names[] = { "English", "简体中文", "Español" };
    g_autofree gchar *preference = NULL;
    const char *locale = g_get_language_names()[0];
    if (g_file_get_contents(probe->preference, &preference, NULL, NULL)) locale = preference;
    int selected = 0;
    for (int i = 0; i < 3; i++) {
        gtk_combo_box_text_append_text(GTK_COMBO_BOX_TEXT(probe->language), names[i]);
        if (g_str_has_prefix(locale, languages[i])) selected = i;
    }
    gtk_combo_box_set_active(GTK_COMBO_BOX(probe->language), selected);
    GtkWidget *actions[] = { probe->language, probe->start, probe->stop, probe->revoke };
    for (size_t i = 0; i < G_N_ELEMENTS(actions); i++) gtk_box_pack_start(GTK_BOX(controls), actions[i], FALSE, FALSE, 0);
    gtk_box_pack_start(GTK_BOX(code_row), probe->invitation, FALSE, FALSE, 0);
    gtk_box_pack_start(GTK_BOX(code_row), probe->copy, FALSE, FALSE, 0);
    gtk_container_add(GTK_CONTAINER(scroll), GTK_WIDGET(probe->activity));
    GtkWidget *rows[] = { controls, probe->status, code_row, probe->choices, scroll };
    for (size_t i = 0; i < G_N_ELEMENTS(rows); i++) gtk_box_pack_start(GTK_BOX(panel), rows[i], rows[i] == scroll, TRUE, 0);
    gtk_container_add(GTK_CONTAINER(probe->window), panel);
    g_signal_connect(probe->language, "changed", G_CALLBACK(change_language), probe);
    g_signal_connect(probe->start, "clicked", G_CALLBACK(start), probe);
    g_signal_connect(probe->stop, "clicked", G_CALLBACK(end_click), probe);
    g_signal_connect(probe->revoke, "clicked", G_CALLBACK(revoke), probe);
    g_signal_connect(probe->copy, "clicked", G_CALLBACK(copy), probe);
    g_signal_connect(probe->window, "delete-event", G_CALLBACK(close_window), probe);
    update_labels(probe);
    gtk_widget_show_all(probe->window);
}

int main(int argc, char **argv) {
    g_autofree gchar *program = g_file_read_link("/proc/self/exe", NULL);
    if (!program) return 1;
    g_autofree gchar *folder = g_path_get_dirname(program);
    g_autofree gchar *root = g_build_filename(folder, "runtime", NULL);
    if (argc == 2 && !strcmp(argv[1], "--check-runtime")) {
        g_autofree gchar *node = g_build_filename(root, "node", NULL);
        g_autofree gchar *cli = g_build_filename(root, "dist", "cli.js", NULL);
        g_autoptr(GSubprocess) worker = g_subprocess_new(G_SUBPROCESS_FLAGS_NONE, NULL, node, cli, "help", NULL);
        return worker && g_subprocess_wait_check(worker, NULL, NULL) ? 0 : 1;
    }
    g_autofree gchar *labels_path = g_build_filename(root, "labels.json", NULL);
    g_autofree gchar *preferences = g_build_filename(g_get_user_config_dir(), "diagnose", "probe-language", NULL);
    g_autoptr(JsonParser) labels = json_parser_new();
    if (!json_parser_load_from_file(labels, labels_path, NULL)) return 1;
    Probe probe = { .labels = labels, .root = root, .preference = preferences };
    g_autoptr(GtkApplication) app = gtk_application_new("com.fenginwind.diagnose.probe", 0);
    g_signal_connect(app, "activate", G_CALLBACK(activate), &probe);
    return g_application_run(G_APPLICATION(app), argc, argv);
}
