#!/usr/bin/env node
// The fast checks: build, the rules and code checks, and the page smoke test (every view and lens draws, no dead
// ends). On the sample vault by default; --vault [dir] runs them on a real vault's rules and graph data.
//   node tests/run.js [--vault [dir]]        exit 1 when any fails
//   --only lens_load,rules                   just the named tests
//   --changed[=ref]                          just the tests that load what this branch changed since ref (default origin/main),
//                                            uncommitted and new files included; a shared file changed runs them all (tests/select.js)
//   --list                                   print the steps that would run, and stop
// GitHub runs every step on every pull request, whatever was picked here.
// live_e2e.js acts on every suggestion in a copy of the vault. Slower, by hand: click_all.js (every control, ~5 min), layout_random.js, shots.js, polish_loop.js.
const fs = require("fs"), os = require("os"), path = require("path"), { spawnSync } = require("child_process");
const env = require("./env"), build = require("../build"), select = require("./select");

// the plugin as it would be installed, built with the rules under test
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vg-build-"));
for (const [f, text] of Object.entries(build.buildPlugin(env.rules))) fs.writeFileSync(path.join(dir, f), text);

const steps = [
  ["main.js", ["--check", path.join(dir, "main.js")]],
  ["rules.js", [path.join(dir, "rules.js")]],
  ["test_word_matching.js", [path.join(__dirname, "test_word_matching.js")]],
  ["test_shared.js", [path.join(__dirname, "test_shared.js")]],
  ["test_kit.js", [path.join(__dirname, "test_kit.js")]],
  ["test_parts.js", [path.join(__dirname, "test_parts.js"), ...env.args]],
  ["test_release.js", [path.join(__dirname, "test_release.js")]],
  ["test_fixture_dates.js", [path.join(__dirname, "test_fixture_dates.js"), ...env.args]],
  ["test_rules.js", [path.join(__dirname, "test_rules.js"), ...env.args]],
  ["test_topic_labels.js", [path.join(__dirname, "test_topic_labels.js"), ...env.args]],
  ["test_tab_keys.js", [path.join(__dirname, "test_tab_keys.js"), ...env.args]],
  ["test_task_source.js", [path.join(__dirname, "test_task_source.js"), ...env.args]],
  ["test_escape_timelapse.js", [path.join(__dirname, "test_escape_timelapse.js"), ...env.args]],
  ["test_tour_waits.js", [path.join(__dirname, "test_tour_waits.js"), ...env.args]],
  ["test_dialog_a11y.js", [path.join(__dirname, "test_dialog_a11y.js"), ...env.args]],
  ["test_panel_focus.js", [path.join(__dirname, "test_panel_focus.js"), ...env.args]],
  ["test_wording_units.js", [path.join(__dirname, "test_wording_units.js"), ...env.args]],
  ["test_press_states.js", [path.join(__dirname, "test_press_states.js"), ...env.args]],
  ["test_touch_labels.js", [path.join(__dirname, "test_touch_labels.js"), ...env.args]],
  ["test_matrix_phone.js", [path.join(__dirname, "test_matrix_phone.js"), ...env.args]],
  ["test_gap_counts.js", [path.join(__dirname, "test_gap_counts.js"), ...env.args]],
  ["test_persona_plan.js", [path.join(__dirname, "test_persona_plan.js"), ...env.args]],
  ["test_every_tap_target.js", [path.join(__dirname, "test_every_tap_target.js"), ...env.args]],
  ["test_monkey.js", [path.join(__dirname, "test_monkey.js"), ...env.args]],
  ["test_escape_dialog.js", [path.join(__dirname, "test_escape_dialog.js"), ...env.args]],
  ["test_tour_toast.js", [path.join(__dirname, "test_tour_toast.js"), ...env.args]],
  ["test_lens_leaves_game.js", [path.join(__dirname, "test_lens_leaves_game.js"), ...env.args]],
  ["test_design.js", [path.join(__dirname, "test_design.js"), ...env.args]],
  ["test_moves.js", [path.join(__dirname, "test_moves.js"), ...env.args]],
  ["test_hq_layout.js", [path.join(__dirname, "test_hq_layout.js"), ...env.args]],
  ["test_hq_features.js", [path.join(__dirname, "test_hq_features.js"), ...env.args]],
  ["test_hq_ux.js", [path.join(__dirname, "test_hq_ux.js"), ...env.args]],
  ["test_hq_strip_legend.js", [path.join(__dirname, "test_hq_strip_legend.js"), ...env.args]],
  ["test_hq_dock_labels.js", [path.join(__dirname, "test_hq_dock_labels.js"), ...env.args]],
  ["test_hq_carried_order.js", [path.join(__dirname, "test_hq_carried_order.js"), ...env.args]],
  ["test_hq_back_layers.js", [path.join(__dirname, "test_hq_back_layers.js"), ...env.args]],
  ["test_hq_polish.js", [path.join(__dirname, "test_hq_polish.js"), ...env.args]],
  ["test_hq_next.js", [path.join(__dirname, "test_hq_next.js"), ...env.args]],
  ["test_analysis_pace.js", [path.join(__dirname, "test_analysis_pace.js")]],
  ["test_hq_a11y.js", [path.join(__dirname, "test_hq_a11y.js"), ...env.args]],
  ["test_triage.js", [path.join(__dirname, "test_triage.js"), ...env.args]],
  ["test_home_runlog_labels.js", [path.join(__dirname, "test_home_runlog_labels.js"), ...env.args]],
  ["test_brief_new_since.js", [path.join(__dirname, "test_brief_new_since.js"), ...env.args]],
  ["test_home_card_order.js", [path.join(__dirname, "test_home_card_order.js"), ...env.args]],
  ["test_home_plain_upkeep.js", [path.join(__dirname, "test_home_plain_upkeep.js"), ...env.args]],
  ["test_home_card_words.js", [path.join(__dirname, "test_home_card_words.js"), ...env.args]],
  ["test_inbox_settled.js", [path.join(__dirname, "test_inbox_settled.js"), ...env.args]],
  ["test_dates_one_format.js", [path.join(__dirname, "test_dates_one_format.js"), ...env.args]],
  ["test_week_legend.js", [path.join(__dirname, "test_week_legend.js"), ...env.args]],
  ["test_map_why_checkable.js", [path.join(__dirname, "test_map_why_checkable.js"), ...env.args]],
  ["test_chip_units_phone.js", [path.join(__dirname, "test_chip_units_phone.js"), ...env.args]],
  ["test_home_cards_plain.js", [path.join(__dirname, "test_home_cards_plain.js"), ...env.args]],
  ["test_phone_dock_clears.js", [path.join(__dirname, "test_phone_dock_clears.js"), ...env.args]],
  ["test_phone_clock_row.js", [path.join(__dirname, "test_phone_clock_row.js"), ...env.args]],
  ["test_brief_person_source.js", [path.join(__dirname, "test_brief_person_source.js"), ...env.args]],
  ["test_home_rail_on_pick.js", [path.join(__dirname, "test_home_rail_on_pick.js"), ...env.args]],
  ["test_brief_needs_count.js", [path.join(__dirname, "test_brief_needs_count.js"), ...env.args]],
  ["test_rail_empty_words.js", [path.join(__dirname, "test_rail_empty_words.js"), ...env.args]],
  ["test_home_next_once.js", [path.join(__dirname, "test_home_next_once.js"), ...env.args]],
  ["test_home_alert_once.js", [path.join(__dirname, "test_home_alert_once.js"), ...env.args]],
  ["test_home_one_summary.js", [path.join(__dirname, "test_home_one_summary.js"), ...env.args]],
  ["test_one_filter_bar.js", [path.join(__dirname, "test_one_filter_bar.js"), ...env.args]],
  ["test_row_source_line.js", [path.join(__dirname, "test_row_source_line.js"), ...env.args]],
  ["test_duplicate_label.js", [path.join(__dirname, "test_duplicate_label.js"), ...env.args]],
  ["test_layout_only_today.js", [path.join(__dirname, "test_layout_only_today.js"), ...env.args]],
  ["test_people_first_names.js", [path.join(__dirname, "test_people_first_names.js"), ...env.args]],
  ["test_palettes.js", [path.join(__dirname, "test_palettes.js"), ...env.args]],
  ["test_hq_dot_legend.js", [path.join(__dirname, "test_hq_dot_legend.js"), ...env.args]],
  ["test_hq_projects_lede.js", [path.join(__dirname, "test_hq_projects_lede.js"), ...env.args]],
  ["test_hq_day_label.js", [path.join(__dirname, "test_hq_day_label.js"), ...env.args]],
  ["test_hq_threads_count_label.js", [path.join(__dirname, "test_hq_threads_count_label.js"), ...env.args]],
  ["test_hq_person_count_label.js", [path.join(__dirname, "test_hq_person_count_label.js"), ...env.args]],
  ["test_hq_title_once.js", [path.join(__dirname, "test_hq_title_once.js"), ...env.args]],
  ["test_hq_carried_later.js", [path.join(__dirname, "test_hq_carried_later.js"), ...env.args]],
  ["test_palette_editor.js", [path.join(__dirname, "test_palette_editor.js"), ...env.args]],
  ["test_palette_suggest.js", [path.join(__dirname, "test_palette_suggest.js"), ...env.args]],
  ["test_upkeep_open.js", [path.join(__dirname, "test_upkeep_open.js"), ...env.args]],
  ["test_edit_colours_any_theme.js", [path.join(__dirname, "test_edit_colours_any_theme.js"), ...env.args]],
  ["test_insights_footer.js", [path.join(__dirname, "test_insights_footer.js"), ...env.args]],
  ["test_since_last_run_card.js", [path.join(__dirname, "test_since_last_run_card.js"), ...env.args]],
  ["test_rank_wording.js", [path.join(__dirname, "test_rank_wording.js"), ...env.args]],
  ["test_tour_once.js", [path.join(__dirname, "test_tour_once.js"), ...env.args]],
  ["test_phone_selects.js", [path.join(__dirname, "test_phone_selects.js"), ...env.args]],
  ["test_view_help_marks.js", [path.join(__dirname, "test_view_help_marks.js"), ...env.args]],
  ["test_clear_filter.js", [path.join(__dirname, "test_clear_filter.js"), ...env.args]],
  ["test_topic_one_name.js", [path.join(__dirname, "test_topic_one_name.js"), ...env.args]],
  ["test_graph_palette.js", [path.join(__dirname, "test_graph_palette.js"), ...env.args]],
  ["test_theme_all_obsidian.js", [path.join(__dirname, "test_theme_all_obsidian.js"), ...env.args]],
  ["test_automations_words.js", [path.join(__dirname, "test_automations_words.js"), ...env.args]],
  ["test_dock_gap.js", [path.join(__dirname, "test_dock_gap.js"), ...env.args]],
  ["test_registry_lines.js", [path.join(__dirname, "test_registry_lines.js"), ...env.args]],
  ["test_needs_order.js", [path.join(__dirname, "test_needs_order.js"), ...env.args]],
  ["test_empty_words.js", [path.join(__dirname, "test_empty_words.js"), ...env.args]],
  ["test_rail_empty.js", [path.join(__dirname, "test_rail_empty.js"), ...env.args]],
  ["test_today_words.js", [path.join(__dirname, "test_today_words.js"), ...env.args]],
  ["test_context_short.js", [path.join(__dirname, "test_context_short.js"), ...env.args]],
  ["test_kind_name.js", [path.join(__dirname, "test_kind_name.js"), ...env.args]],
  ["test_triage_order.js", [path.join(__dirname, "test_triage_order.js"), ...env.args]],
  ["test_triage_words.js", [path.join(__dirname, "test_triage_words.js"), ...env.args]],
  ["test_play.js", [path.join(__dirname, "test_play.js"), ...env.args]],
  ["test_cdp.js", [path.join(__dirname, "test_cdp.js")]],
  ["test_plugin_rules.js", [path.join(__dirname, "test_plugin_rules.js")]],
  ["test_engine.js", [path.join(__dirname, "test_engine.js")]],
  ["test_cosmos_binary.js", [path.join(__dirname, "test_cosmos_binary.js")]],
  ["test_science.js", [path.join(__dirname, "test_science.js")]],
  ["test_depth.js", [path.join(__dirname, "test_depth.js"), ...env.args]],
  ["test_engine_data.js", [path.join(__dirname, "test_engine_data.js")]],
  ["test_cosmos_capture.js", [path.join(__dirname, "test_cosmos_capture.js")]],
  ["test_dungeon.js", [path.join(__dirname, "test_dungeon.js"), ...env.args]],
  ["test_cyberpunk.js", [path.join(__dirname, "test_cyberpunk.js"), ...env.args]],
  ["test_timelapse.js", [path.join(__dirname, "test_timelapse.js"), ...env.args]],
  ["test_dimensions.js", [path.join(__dirname, "test_dimensions.js"), ...env.args]],
  ["test_born_date.js", [path.join(__dirname, "test_born_date.js")]],
  ["test_hq_reactions.js", [path.join(__dirname, "test_hq_reactions.js"), ...env.args]],
  ["test_hq_brain.js", [path.join(__dirname, "test_hq_brain.js"), ...env.args]],
  ["test_hq_cockpit.js", [path.join(__dirname, "test_hq_cockpit.js"), ...env.args]],
  ["test_hq_layouts.js", [path.join(__dirname, "test_hq_layouts.js"), ...env.args]],
  ["test_design_rules.js", [path.join(__dirname, "test_design_rules.js"), ...env.args]],
  ["test_search_quality.js", [path.join(__dirname, "test_search_quality.js"), ...env.args]],
  ["test_sync.js", [path.join(__dirname, "test_sync.js")]],
  ["test_no_python.js", [path.join(__dirname, "test_no_python.js")]],
  ["test_cosmos_views.js", [path.join(__dirname, "test_cosmos_views.js")]],
  ["test_cosmos_seed.js", [path.join(__dirname, "test_cosmos_seed.js")]],
  ["test_cosmos_coupling.js", [path.join(__dirname, "test_cosmos_coupling.js")]],
  ["test_queue.js", [path.join(__dirname, "test_queue.js")]],
  ["test_ship.js", [path.join(__dirname, "test_ship.js")]],
  ["test_ci_release.js", [path.join(__dirname, "test_ci_release.js")]],
  ["test_update.js", [path.join(__dirname, "test_update.js")]],
  ["test_tap_floor.js", [path.join(__dirname, "test_tap_floor.js")]],
  ["test_view_legends.js", [path.join(__dirname, "test_view_legends.js")]],
  ["test_viewhelp_escape.js", [path.join(__dirname, "test_viewhelp_escape.js"), ...env.args]],
  ["test_ring_colour_key.js", [path.join(__dirname, "test_ring_colour_key.js"), ...env.args]],
  ["test_ring_colour_key_desktop.js", [path.join(__dirname, "test_ring_colour_key_desktop.js"), ...env.args]],
  ["test_ring_number_wording.js", [path.join(__dirname, "test_ring_number_wording.js"), ...env.args]],
  ["test_hidden_notes_named.js", [path.join(__dirname, "test_hidden_notes_named.js"), ...env.args]],
  ["test_ring_reasons_cue.js", [path.join(__dirname, "test_ring_reasons_cue.js"), ...env.args]],
  ["test_note_card_dates.js", [path.join(__dirname, "test_note_card_dates.js"), ...env.args]],
  ["test_today_strip_whole.js", [path.join(__dirname, "test_today_strip_whole.js"), ...env.args]],
  ["test_size_one_name.js", [path.join(__dirname, "test_size_one_name.js"), ...env.args]],
  ["test_viewhelp_reachable.js", [path.join(__dirname, "test_viewhelp_reachable.js"), ...env.args]],
  ["test_ring_legend_number.js", [path.join(__dirname, "test_ring_legend_number.js"), ...env.args]],
  ["test_today_strip_expand.js", [path.join(__dirname, "test_today_strip_expand.js"), ...env.args]],
  ["test_lens_load_failed.js", [path.join(__dirname, "test_lens_load_failed.js")]],
  ["test_attention_ring.js", [path.join(__dirname, "test_attention_ring.js")]],
  ["test_refs_in_use.js", [path.join(__dirname, "test_refs_in_use.js"), ...env.args]],
  ["test_view_scale.js", [path.join(__dirname, "test_view_scale.js")]],
  ["test_attention_library.js", [path.join(__dirname, "test_attention_library.js")]],
  ["test_shards.js", [path.join(__dirname, "test_shards.js")]],
  ["test_map_apply.js", [path.join(__dirname, "test_map_apply.js")]],
  ["live_e2e.js", [path.join(__dirname, "live_e2e.js"), ...env.args]],
  ["test_pick.js", [path.join(__dirname, "test_pick.js"), ...env.args]],
  ["test_words.js", [path.join(__dirname, "test_words.js"), ...env.args]],
  ["test_graph_a11y.js", [path.join(__dirname, "test_graph_a11y.js"), ...env.args]],
  ["test_view_labels.js", [path.join(__dirname, "test_view_labels.js"), ...env.args]],
  ["test_cosmos_phone.js", [path.join(__dirname, "test_cosmos_phone.js"), ...env.args]],
  ["test_hq_back.js", [path.join(__dirname, "test_hq_back.js")]],
  ["test_save_binary.js", [path.join(__dirname, "test_save_binary.js")]],
  ["test_hq_plugin.js", [path.join(__dirname, "test_hq_plugin.js"), ...env.args]],
  ["test_hq.js", [path.join(__dirname, "test_hq.js"), ...env.args]],
  ["test_hq_daily.js", [path.join(__dirname, "test_hq_daily.js"), ...env.args]],
  ["test_hq_navigation.js", [path.join(__dirname, "test_hq_navigation.js"), ...env.args]],
  ["test_hq_improvements.js", [path.join(__dirname, "test_hq_improvements.js"), ...env.args]],
  ["test_hq_usability.js", [path.join(__dirname, "test_hq_usability.js"), ...env.args]],
  ["test_other_vault.js", [path.join(__dirname, "test_other_vault.js")]],
  ["test_lens_load.js", [path.join(__dirname, "test_lens_load.js"), ...env.args]],
  ["test_lens_states.js", [path.join(__dirname, "test_lens_states.js"), ...env.args]],
  ["test_phone_overlays.js", [path.join(__dirname, "test_phone_overlays.js"), ...env.args]],
  ["test_escape_layers.js", [path.join(__dirname, "test_escape_layers.js"), ...env.args]],
  ["test_a11y_names.js", [path.join(__dirname, "test_a11y_names.js"), ...env.args]],
  ["test_empty_next.js", [path.join(__dirname, "test_empty_next.js"), ...env.args]],
  ["test_empty_sections.js", [path.join(__dirname, "test_empty_sections.js"), ...env.args]],
  ["test_phone_legend.js", [path.join(__dirname, "test_phone_legend.js"), ...env.args]],
  ["test_said_unlinked_agree.js", [path.join(__dirname, "test_said_unlinked_agree.js"), ...env.args]],
  ["test_link_words.js", [path.join(__dirname, "test_link_words.js"), ...env.args]],
  ["test_map_percent_label.js", [path.join(__dirname, "test_map_percent_label.js"), ...env.args]],
  ["test_note_trail.js", [path.join(__dirname, "test_note_trail.js"), ...env.args]],
  ["test_ink_contrast.js", [path.join(__dirname, "test_ink_contrast.js"), ...env.args]],
  ["test_counts_agree.js", [path.join(__dirname, "test_counts_agree.js"), ...env.args]],
  ["test_notes_total.js", [path.join(__dirname, "test_notes_total.js"), ...env.args]],
  ["test_maps_count.js", [path.join(__dirname, "test_maps_count.js"), ...env.args]],
  ["test_plain_influence.js", [path.join(__dirname, "test_plain_influence.js"), ...env.args]],
  ["test_rank_ties.js", [path.join(__dirname, "test_rank_ties.js"), ...env.args]],
  ["test_hq_phone_tray.js", [path.join(__dirname, "test_hq_phone_tray.js"), ...env.args]],
  ["test_hq_phone_header.js", [path.join(__dirname, "test_hq_phone_header.js"), ...env.args]],
  ["test_maps_card_all.js", [path.join(__dirname, "test_maps_card_all.js"), ...env.args]],
  ["test_search_no_noise.js", [path.join(__dirname, "test_search_no_noise.js"), ...env.args]],
  ["test_topic_ink.js", [path.join(__dirname, "test_topic_ink.js"), ...env.args]],
  ["test_topic_not_red.js", [path.join(__dirname, "test_topic_not_red.js"), ...env.args]],
  ["test_related_notes.js", [path.join(__dirname, "test_related_notes.js"), ...env.args]],
  ["test_job_words.js", [path.join(__dirname, "test_job_words.js"), ...env.args]],
  ["test_triage_hints.js", [path.join(__dirname, "test_triage_hints.js"), ...env.args]],
  ["test_triage_phone.js", [path.join(__dirname, "test_triage_phone.js"), ...env.args]],
  ["test_triage_count.js", [path.join(__dirname, "test_triage_count.js"), ...env.args]],
  ["test_open_labels.js", [path.join(__dirname, "test_open_labels.js"), ...env.args]],
  ["test_display_reach.js", [path.join(__dirname, "test_display_reach.js"), ...env.args]],
  ["test_tile_lands.js", [path.join(__dirname, "test_tile_lands.js"), ...env.args]],
  ["test_phone_text_size.js", [path.join(__dirname, "test_phone_text_size.js"), ...env.args]],
  ["test_tour_cards.js", [path.join(__dirname, "test_tour_cards.js"), ...env.args]],
  ["test_legend_ink.js", [path.join(__dirname, "test_legend_ink.js"), ...env.args]],
  ["test_narrow_pane.js", [path.join(__dirname, "test_narrow_pane.js"), ...env.args]],
  ["test_chart_text_size.js", [path.join(__dirname, "test_chart_text_size.js"), ...env.args]],
  ["test_map_row_back.js", [path.join(__dirname, "test_map_row_back.js"), ...env.args]],
  ["test_resize_no_blank.js", [path.join(__dirname, "test_resize_no_blank.js"), ...env.args]],
  ["test_overlays_apart.js", [path.join(__dirname, "test_overlays_apart.js"), ...env.args]],
  ["test_stat_cards.js", [path.join(__dirname, "test_stat_cards.js"), ...env.args]],
  ["test_gap_text.js", [path.join(__dirname, "test_gap_text.js"), ...env.args]],
  ["test_gap_rank.js", [path.join(__dirname, "test_gap_rank.js"), ...env.args]],
  ["test_view_picker.js", [path.join(__dirname, "test_view_picker.js"), ...env.args]],
  ["test_tour_start.js", [path.join(__dirname, "test_tour_start.js")]],
  ["test_lens_contrast.js", [path.join(__dirname, "test_lens_contrast.js")]],
  ["test_phone_picker.js", [path.join(__dirname, "test_phone_picker.js")]],
  ["test_drawer_back.js", [path.join(__dirname, "test_drawer_back.js")]],
  ["test_guide_scan.js", [path.join(__dirname, "test_guide_scan.js"), ...env.args]],
  ["test_cas9.js", [path.join(__dirname, "test_cas9.js"), ...env.args]],
  ["test_library_views.js", [path.join(__dirname, "test_library_views.js"), ...env.args]],
  ["test_declined_shared.js", [path.join(__dirname, "test_declined_shared.js")]],
  ["test_toolbar_fit.js", [path.join(__dirname, "test_toolbar_fit.js")]],
  ["test_views_contract.js", [path.join(__dirname, "test_views_contract.js"), ...env.args]],
  ["test_sweep_vitals.js", [path.join(__dirname, "test_sweep_vitals.js"), ...env.args]],
  ["test_select.js", [path.join(__dirname, "test_select.js")]],
  ["smoke_page.js", [path.join(__dirname, "smoke_page.js"), ...env.args]]
];
// every other tests/test_*.js is a step too, in file order, so a new test needs no line here (test_every_test_runs.js guards it)
{ const have = new Set(steps.map(s => s[0]));
  for (const f of fs.readdirSync(__dirname).filter(f => /^test_.*\.js$/.test(f)).sort()) if (!have.has(f)) steps.push([f, [path.join(__dirname, f), ...env.args]]); }
const stop = msg => { console.error("FAIL  " + msg); process.exit(1); };
// --only and --changed narrow the steps; picked stays null when every step runs
let picked = null, pickedBy = "";
const onlyAt = process.argv.indexOf("--only"), changedArg = process.argv.find(a => a === "--changed" || a.startsWith("--changed="));
if (onlyAt > 0 && changedArg) stop("--only and --changed: use one of them");
if (onlyAt > 0) {
  const arg = process.argv[onlyAt + 1];
  if (!arg || arg.startsWith("--")) stop("--only needs test names, comma-separated: --only lens_load,rules (node tests/run.js --list shows them)");
  const r = select.pickOnly(arg.split(","), steps.map(s => s[0]));
  if (r.unknown.length) stop(`--only: no test named ${r.unknown.join(", ")} (node tests/run.js --list shows them)`);
  picked = new Set(r.names); pickedBy = "--only";
}
if (changedArg) {
  const ref = changedArg.includes("=") ? changedArg.slice(changedArg.indexOf("=") + 1) : "origin/main";
  const git = a => { const r = spawnSync("git", a, { cwd: build.ROOT, encoding: "utf8" });
    if (r.error) stop("--changed needs git: " + r.error.message + ". Run npm test for every test.");
    if (r.status !== 0) stop(`--changed: git ${a.join(" ")} failed: ${(r.stderr || "").trim().split("\n")[0]}. Is "${ref}" there? Run git fetch origin, or name another with --changed=<branch>, or run npm test for every test.`);
    return r.stdout.split("\n").filter(Boolean); };
  // what the branch changed since it left ref, what's changed and not committed, and new files
  const files = [...new Set([...git(["diff", "--name-only", ref + "...HEAD"]), ...git(["diff", "--name-only", "HEAD"]), ...git(["ls-files", "--others", "--exclude-standard"])])];
  const r = select.pickChanged(files, steps.map(s => s[0]), s => { try { return fs.readFileSync(path.join(__dirname, s), "utf8"); } catch (e) { return ""; } });
  if (r.names.length < steps.length) { picked = new Set(r.names); pickedBy = "--changed"; }
  console.error(`  pick  --changed since ${ref}: ${r.names.length} of ${steps.length} tests (${files.length ? r.why : "no file changed"})`);
}
const run = picked ? steps.filter(s => picked.has(s[0])) : steps;
// --shard=i/n runs every n-th step starting at i (GitHub runs the shards side by side); no flag runs all of them
const shardArg = (process.argv.find(a => a.startsWith("--shard=")) || "").slice(8);
const [shard, shards] = shardArg ? shardArg.split("/").map(Number) : [1, 1];
if (!(shards >= 1 && shard >= 1 && shard <= shards)) { console.error("FAIL  --shard=" + shardArg + ": use --shard=i/n with 1 <= i <= n"); process.exit(1); }
const label = (env.VAULT ? env.VAULT : "sample vault") + (shards > 1 ? ", shard " + shard + "/" + shards : "") + (picked ? `, ${run.length} of ${steps.length} tests picked by ${pickedBy}` : "");
if (process.argv.includes("--list")) { console.log(run.filter((_, i) => i % shards === shard - 1).map(x => x[0]).join("\n")); process.exit(0); }
let ran = 0;
let failed = 0, skipped = 0;
// the repo's manifest.json (what BRAT reads) is the one the build makes: same id, same version as package.json
if (shard === 1) { const want = build.buildPlugin(build.loadRules())["manifest.json"];
  let got = ""; try { got = fs.readFileSync(path.join(build.ROOT, "manifest.json"), "utf8"); } catch (e) { /* missing */ }
  const ok = got.replace(/\r\n/g, "\n") === want;
  console.log(`  ${ok ? "test" : "FAIL"}  manifest.json: ${ok ? "ok - matches the build" : "out of date: run node build.js manifest"}`);
  failed += ok ? 0 : 1; }
for (const [name, args] of run.filter((_, i) => i % shards === shard - 1)) {
  const r = spawnSync(process.execPath, args, { encoding: "utf8", timeout: 10 * 60 * 1000 });
  // only a clean exit 0 passes: a step killed (or timed out) has status null, one that didn't start has r.error
  const bad = r.status !== 0, why = r.error ? [r.error.code === "ETIMEDOUT" ? "timed out after 10 minutes" : r.error.message] : r.signal ? [`killed (${r.signal})`] : [];
  const out = [...((r.stdout || "").trim() || (r.stderr || "").trim() || "ok").split(/\r?\n/), ...why];
  // a person at a terminal and GitHub see every step; a script or an agent reading the output sees failures and the total (--verbose for all)
  if (bad || process.stdout.isTTY || process.env.CI || process.argv.includes("--verbose")) console.log(`  ${bad ? "FAIL" : "test"}  ${name}: ${bad ? out.slice(-30).join("\n") : out[out.length - 1]}`);
  failed += bad ? 1 : 0; ran++;
  skipped += /skipped: no Chrome/.test(r.stdout || "") ? 1 : 0;
}
if (skipped) console.log(`  note  ${skipped} browser tests skipped: no Chrome found (set CHROME_PATH to its program). GitHub runs them before it publishes.`);
fs.rmSync(dir, { recursive: true, force: true });
console.log(failed ? `${failed} of ${ran} failed (${label})` : `ok - ${ran} passed, ${label}`);
process.exit(failed ? 1 : 0);
