import 'rxjs/add/operator/distinctUntilChanged';
import 'rxjs/add/operator/combineLatest';

import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  ViewChild,
} from '@angular/core';
import { DropFilesAction } from 'app/components/dialogs';
import {
  ActionMode,
  ActionSource,
} from 'app/scripts/model/actionmode';
import { ActionModeService } from 'app/services/actionmode/actionmode.service';
import { DemoService } from 'app/services/demos/demo.service';
import { DialogService } from 'app/services/dialogs/dialog.service';
import { FileImportService } from 'app/services/import/fileimport.service';
import { ShortcutService } from 'app/services/shortcut/shortcut.service';
import {
  Duration,
  SnackBarService,
} from 'app/services/snackbar/snackbar.service';
import {
  State,
  Store,
} from 'app/store';
import {
  getActionMode,
  getActionModeHover,
} from 'app/store/actionmode/selectors';
import { ClearSelections } from 'app/store/common/actions';
import { isWorkspaceDirty } from 'app/store/common/selectors';
import { ImportVectorLayers } from 'app/store/layers/actions';
import { ResetWorkspace } from 'app/store/reset/actions';
import * as erd from 'element-resize-detector';
import { environment } from 'environments/environment';
import * as $ from 'jquery';
import { BehaviorSubject } from 'rxjs/BehaviorSubject';
import { Observable } from 'rxjs/Observable';

const SHOULD_AUTO_LOAD_DEMO = true;
const IS_DEV_BUILD = !environment.production;
const ELEMENT_RESIZE_DETECTOR = erd();
const STORAGE_KEY_FIRST_TIME_USER = 'storage_key_first_time_user';

declare const ga: Function;

enum CursorType {
  Default = 1,
  Pointer,
  Pen,
}

// TODO: show confirmation dialog when dropping a file into a dirty workspace
@Component({
  selector: 'app-root',
  templateUrl: './root.component.html',
  styleUrls: ['./root.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RootComponent implements OnInit, AfterViewInit, OnDestroy {
  readonly ACTION_SOURCE_FROM = ActionSource.From;
  readonly ACTION_SOURCE_ANIMATED = ActionSource.Animated;
  readonly ACTION_SOURCE_TO = ActionSource.To;

  readonly CURSOR_DEFAULT = CursorType.Default;
  readonly CURSOR_POINTER = CursorType.Pointer;
  readonly CURSOR_PEN = CursorType.Pen;

  @ViewChild('displayContainer') displayContainerRef: ElementRef;
  private $displayContainer: JQuery;

  private readonly displayBoundsSubject = new BehaviorSubject<Size>({ w: 1, h: 1 });
  canvasBounds$: Observable<Size>;
  isActionMode$: Observable<boolean>;
  cursorType$: Observable<CursorType>;

  constructor(
    private readonly snackBarService: SnackBarService,
    private readonly fileImportService: FileImportService,
    private readonly store: Store<State>,
    private readonly actionModeService: ActionModeService,
    private readonly shortcutService: ShortcutService,
    private readonly demoService: DemoService,
    private readonly dialogService: DialogService,
  ) { }

  ngOnInit() {
    this.shortcutService.init();

    // TODO: we should check to see if there are any dirty changes first
    $(window).on('beforeunload', event => {
      if (!IS_DEV_BUILD) {
        return 'You\'ve made changes but haven\'t saved. ' +
          'Are you sure you want to navigate away?';
      }
      return undefined;
    });

    const displaySize$ = this.displayBoundsSubject.asObservable()
      .distinctUntilChanged(({ w: w1, h: h1 }, { w: w2, h: h2 }) => {
        return w1 === w2 && h1 === h2;
      });
    this.isActionMode$ = this.store.select(getActionMode).map(mode => mode !== ActionMode.None);
    this.canvasBounds$ = Observable.combineLatest(displaySize$, this.isActionMode$)
      .map(([{ w, h }, shouldShowThreeCanvases]) => {
        return { w: w / (shouldShowThreeCanvases ? 3 : 1), h };
      });

    this.cursorType$ =
      Observable.combineLatest(
        this.store.select(getActionMode),
        this.store.select(getActionModeHover),
      ).map(([mode, hover]) => {
        if (mode === ActionMode.SplitCommands || mode === ActionMode.SplitSubPaths) {
          return CursorType.Pen;
        } else if (hover) {
          return CursorType.Pointer;
        }
        return CursorType.Default;
      });
  }

  ngAfterViewInit() {
    this.$displayContainer = $(this.displayContainerRef.nativeElement);
    ELEMENT_RESIZE_DETECTOR.listenTo(this.$displayContainer.get(0), el => {
      const w = this.$displayContainer.width();
      const h = this.$displayContainer.height();
      this.displayBoundsSubject.next({ w, h });
    });

    if ('serviceWorker' in navigator) {
      const isFirstTimeUser = window.localStorage.getItem(STORAGE_KEY_FIRST_TIME_USER);
      if (!isFirstTimeUser) {
        window.localStorage.setItem(STORAGE_KEY_FIRST_TIME_USER, 'true');
        setTimeout(() => {
          this.snackBarService.show('Ready to work offline', 'Dismiss', Duration.Long);
        });
      }
    }

    if (IS_DEV_BUILD && SHOULD_AUTO_LOAD_DEMO) {
      this.demoService.getDemo('morphinganimals')
        .then(({ vectorLayer, animation, hiddenLayerIds }) => {
          this.store.dispatch(new ResetWorkspace(vectorLayer, animation, hiddenLayerIds));
        });
    }
  }

  ngOnDestroy() {
    ELEMENT_RESIZE_DETECTOR.removeAllListeners(this.$displayContainer.get(0));
    this.shortcutService.destroy();
    $(window).unbind('beforeunload');
  }

  // Called by the DropTargetDirective.
  onDropFiles(fileList: FileList) {
    // TODO: if dropping a JSON file, then prompt the user
    // the same way as the new workspace dialog
    this.dialogService
      .dropFiles()
      .subscribe(action => {
        if (action === DropFilesAction.AddToWorkspace) {
          // TODO: add as layers
          this.fileImportService.import(fileList);
        } else if (action === DropFilesAction.ResetWorkspace) {
          this.fileImportService.import(fileList);
        }
      });
  }

  onClick(event: MouseEvent) {
    if (!this.actionModeService.isActionMode()) {
      this.store.dispatch(new ClearSelections());
    }
  }
}

interface Size {
  readonly w: number;
  readonly h: number;
}
